var path = require('path');
var util = require('util');
var format = util.format;

var args = process.argv.slice(1);
var program = path.basename(args.shift());

var PbServer = require('./pb-server');

var log = function() {
  console.log.apply(this, arguments);
}

var config = require('./config');

var pb = new PbServer(config.pb, config.ssh);

var debugCallback = function(err, data) {
  if (err) {
    log("ERROR: " + String(err));
  }
  else {
    log(data);
  }
}

function bytesToSize(bytes) {
   var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
   if (bytes == 0) return '0 Byte';
   var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
   return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
};

switch (args[0]) {
  case 'start':
    pb.startServerTracked();
    break;
  case 'shutdown':
    pb.shutdownServerTracked();
    break;
  case 'stop':
    pb.stopServerTracked();
    break;
  case 'safe-stop':
    var cb = function(err, data) {
      // Even if there was a failure in shutdown, we still want to stop, so no
      // need to verify what happened here.
      pb.stopServerTracked();
    }
    pb.shutdownServerTracked(cb);
    break;
  case 'status':
    var cb = function(err, data) {
      if (err) {
        log(format("ERROR: %s", err));
      }
      else {
        var name = data.properties.name;
        var machineState = data.metadata.state;
        var serverState = data.properties.vmState;
        var cores = data.properties.cores;
        var ram = data.properties.ram;
        log(format("Name: %s", name));
        log(format("Machine state: %s", machineState));
        log(format("Server state: %s", serverState));
        log(format("Cores: %d", cores));
        log(format("RAM: %s", bytesToSize(ram * 1000000)));
      }
    }
    pb.getServer(cb);
    break;
  case 'update':
    var profile = args[1];
    var cb = function(err, data) {
      if (err) {
        log(format("ERROR: %s", err));
      }
      else {
        log("Server updated!");
        var name = data.properties.name;
        var cores = data.properties.cores;
        var ram = data.properties.ram;
        log(format("Name: %s", name));
        log(format("Cores: %d", cores));
        log(format("RAM: %s", bytesToSize(ram * 1000000)));
      }
    }
    pb.updateServer(profile, cb);
    break;
  case 'check-fs':
    log("Checking FreeSWITCH service...");
    pb.checkCommand("service freeswitch status");
    break;
  case 'datacenters':
    var cb = function(err, data) {
      if (err) {
        log(format("ERROR: %s", err));
      }
      else {
        var iterator = function (val, idx, array) {
          log(format("%s: %s", val.properties.name, val.id));
        }
        data.items.forEach(iterator);
      }
    }
    pb.listDatacenters(cb);
    break;
  case 'servers':
    var cb = function(err, data) {
      if (err) {
        log(format("ERROR: %s", err));
      }
      else {
        var iterator = function (val, idx, array) {
          log(format("%s: %s", val.properties.name, val.id));
        }
        data.items.forEach(iterator);
      }
    }
    pb.listServers(cb);
    break;
  default:
    log("Usage: " + program + " <start|shutdown|stop|safe-stop|status|update <profile>|check-fs|datacenters|servers>");
}
