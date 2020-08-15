const mc = require('minecraft-protocol')
const bufferEqual = require('buffer-equal')
const forgeHandshake = require('minecraft-protocol-forge').forgeHandshake;
const autoVersionForge = require('minecraft-protocol-forge').autoVersionForge;

const states = mc.states
function printHelpAndExit (exitCode) {
  console.log('usage: node proxy.js [<options>...] <target_srv> <version>')
  console.log('options:')
  console.log('  --dump name')
  console.log('    print to stdout messages with the specified name.')
  console.log('  --dump-all')
  console.log('    print to stdout all messages, except those specified with -x.')
  console.log('  -x name')
  console.log('    do not print messages with this name.')
  console.log('  name')
  console.log('    a packet name as defined in protocol.json')
  console.log('examples:')
  console.log('  node proxy.js --dump-all -x keep_alive -x update_time -x entity_velocity -x rel_entity_move -x entity_look -x entity_move_look -x entity_teleport -x entity_head_rotation -x position localhost 1.8')
  console.log('    print all messages except for some of the most prolific.')
  console.log('  node examples/proxy.js --dump open_window --dump close_window --dump set_slot --dump window_items --dump craft_progress_bar --dump transaction --dump close_window --dump window_click --dump set_creative_slot --dump enchant_item localhost 1.8')
  console.log('    print messages relating to inventory management.')

  process.exit(exitCode)
}

if (process.argv.length < 4) {
  console.log('Too few arguments!')
  printHelpAndExit(1)
}

process.argv.forEach(function (val) {
  if (val === '-h') {
    printHelpAndExit(0)
  }
})

const args = process.argv.slice(2)
let host
let port = 25566
let version

let printAllNames = false
const printNameWhitelist = {}
const printNameBlacklist = {};
(function () {
  let i = 0
  for (i = 0; i < args.length; i++) {
    const option = args[i]
    if (!/^-/.test(option)) break
    if (option === '--dump-all') {
      printAllNames = true
      continue
    }
    i++
    const name = args[i]
    if (option === '--dump') {
      printNameWhitelist[name] = 'io'
    } else if (option === '-x') {
      printNameBlacklist[name] = 'io'
    } else {
      printHelpAndExit(1)
    }
  }
  if (!(i + 2 <= args.length && args.length <= i + 4)) printHelpAndExit(1)
  host = args[i++]
  version = args[i++]
})()

if (host.indexOf(':') !== -1) {
  port = host.substring(host.indexOf(':') + 1)
  host = host.substring(0, host.indexOf(':'))
}

var srv = mc.createServer({
  'online-mode': false,
  port: 25565,
  keepAlive: false,
  version: false,
	motd: Date()
})

setInterval(function(){
	srv.motd = Date();
}, 1000)

srv.on('login', function (client) {
  const addr = client.socket.remoteAddress
  console.log('Incoming connection', '(' + addr + ')')
  let endedClient = false
  let endedserverClient = false
  var serverClient = mc.createClient({
    host: host,
    port: 25567,
    username: client.username,
    keepAlive: false,
    version: false
  })
	client.on('end', clientEnd);
	client.on('error', clientErr);
	client.on('raw', clientRawPacket);
	client.on('packet', clientPacket);

  serverClient.on('packet', tClientPacket);
  serverClient.on('raw', tClientRawPacket);
  serverClient.on('end', tClientEnd);
	serverClient.on('error', tClientErr);

	autoVersionForge(serverClient);
	//autoVersionForge(client);

	setTimeout(function () {
		serverClient.removeListener('packet', tClientPacket);
		serverClient.removeListener('raw', tClientRawPacket);
		serverClient.removeListener('end', tClientEnd);
		serverClient.removeListener('error', tClientErr);
		serverClient.end("");

		serverClient = mc.createClient({
			host: host,
			port: 25566,
			username: client.username,
			keepAlive: false,
			version: false
		})

		serverClient.on('packet', tClientPacket);
		serverClient.on('raw', tClientRawPacket);
		serverClient.on('end', tClientEnd);
		serverClient.on('error', tClientErr);

		autoVersionForge(serverClient);
		//autoVersionForge(client);

		setTimeout(function() {
			client.write('custom_payload', {
        channel: 'FML|HS',
        data: Buffer.from([-2])
      });
			serverClient.write("client_command", {"actionId":0})
			client.write("respawn", {"dimension":0,"difficulty":1,"gamemode":1,"levelType":"default"})
			serverClient.write("position_look", {"x":252.88745622764716,"y":73,"z":267.43780129395924,"yaw":288.2994384765625,"pitch":23.400012969970703,"onGround":false})
		}, 250);
	}, 10000)


	function tClientPacket(data, meta) {
    if (meta.state === states.PLAY && client.state === states.PLAY) {
			if (data.channel == "FML|HS" || data.channel == "FORGE" || data.channel == "REGISTER") return;
      if (shouldDump(meta.name, 'i')) {
        console.log('client<-server:',
          serverClient.state + '.' + meta.name + ' :' +
          JSON.stringify(data))
      }
      //if (!endedClient) {
        client.write(meta.name, data)
        if (meta.name === 'set_compression') {
          client.compressionThreshold = data.threshold
        } // Set compression
      //}
    }
  }
	function tClientRawPacket(buffer, meta) {
		if (client.state !== states.PLAY || meta.state !== states.PLAY) { return }
		let packetData = serverClient.deserializer.parsePacketBuffer(buffer).data.params
		let packetBuff = client.serializer.createPacketBuffer({ name: meta.name, params: packetData })
		if (!bufferEqual(buffer, packetBuff)) {
			console.log('client<-server: Error in packet ' + meta.state + '.' + meta.name)
			console.log('received buffer', buffer.toString('hex'))
			console.log('produced buffer', packetBuff.toString('hex'))
			console.log('received length', buffer.length)
			console.log('produced length', packetBuff.length)
		}
	}
	function tClientEnd() {
    endedserverClient = true
    console.log('Connection closed by server', '(' + addr + ')')
    if (!endedClient) { client.end('End') }
  }
	function tClientErr(err) {
    endedserverClient = true
    console.log('Connection error by server', '(' + addr + ') ', err)
    console.log(err.stack)
    if (!endedClient) { client.end(err) }
  }



	function clientPacket(data, meta) {
    if (serverClient.state === states.PLAY && meta.state === states.PLAY) {
      if (shouldDump(meta.name, 'o')) {
        console.log('client->server:',
          client.state + ' ' + meta.name + ' :',
          JSON.stringify(data))
      }
      //if (!endedserverClient) { serverClient.write(meta.name, data) }
			serverClient.write(meta.name, data)
    }
  }
	function clientRawPacket(buffer, meta) {
    if (meta.state !== states.PLAY || serverClient.state !== states.PLAY) { return }
    let packetData = client.deserializer.parsePacketBuffer(buffer).data.params
    let packetBuff = serverClient.serializer.createPacketBuffer({ name: meta.name, params: packetData })
    if (!bufferEqual(buffer, packetBuff)) {
      console.log('client->server: Error in packet ' + meta.state + '.' + meta.name)
      console.log('received buffer', buffer.toString('hex'))
      console.log('produced buffer', packetBuff.toString('hex'))
      console.log('received length', buffer.length)
      console.log('produced length', packetBuff.length)
    }
  }
	function clientEnd() {
    endedClient = true
    console.log('Connection closed by client', '(' + addr + ')')
    if (!endedserverClient) { serverClient.end('End') }
  }
	function clientErr(err) {
    endedClient = true
    console.log('Connection error by client', '(' + addr + ')')
    console.log(err.stack)
    if (!endedserverClient) { serverClient.end(err) }
  }
})

function shouldDump (name, direction) {
  if (matches(printNameBlacklist[name])) return false
  if (printAllNames) return true
  return matches(printNameWhitelist[name])

  function matches (result) {
    return result !== undefined && result !== null && result.indexOf(direction) !== -1
  }
}
