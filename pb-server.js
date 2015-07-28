var fs = require('fs');
var util = require('util');
var libpb = require('libprofitbricks');
var SSH = require('simple-ssh');
var format = util.format;

var dummyCb = function() {};
// 5 seconds.
var SERVER_QUERY_INTERVAL = 5000;
// 3 minutes total.
var MAX_QUERY_ATTEMPTS = 36;

var PbServer = function(pb, ssh, logger) {
  this.pb = pb;
  this.ssh = ssh;
  if (logger) {
    this.logger = logger;
  }
  else {
    this.logger = console;
    this.logger.debug = this.logger.log;
  }
  this.stateChangeQueryInterval = pb.stateChangeQueryInterval ? pb.stateChangeQueryInterval : SERVER_QUERY_INTERVAL;
  this.maxStateChangeQueryAttempts = pb.maxStateChangeQueryAttempts ? pb.maxStateChangeQueryAttempts : MAX_QUERY_ATTEMPTS;
  this.sshKey = ssh.key ? fs.readFileSync(ssh.key) : null;

  libpb.setauth(this.pb.username, this.pb.password);
  libpb.setdepth(this.pb.depth);

  var self = this;
  var _tracked = function(command, serverToState, vmToState, message, cb) {
    cb = cb ? cb : dummyCb;
    var postCommand = function(err) {
      if (err) {
        cb(err);
      }
      else {
        var stateChangeCallback = function(err, data) {
          if (err) {
            cb(err);
          }
          else {
            self.logger.info(message);
            cb(null, data);
          }
        }
        self.serverStateChange(serverToState, vmToState, stateChangeCallback);
      }
    }
    self[command](postCommand);
  }

  this.startServerTracked = function(cb) {
    _tracked('startServer', 'AVAILABLE', 'RUNNING', 'Server started!', cb);
  }

  this.shutdownServerTracked = function(cb) {
    _tracked('shutdownServer', 'AVAILABLE', 'SHUTOFF', 'Server shut down!', cb);
  }

  this.stopServerTracked = function(cb) {
    _tracked('stopServer', 'INACTIVE', 'SHUTOFF', 'Server stopped!', cb);
  }
}

PbServer.prototype.listDatacenters = function(cb) {
  cb = cb ? cb : dummyCb;
  var apiCallback = function(err, resp, body) {
    if (err) {
      cb(err);
    }
    else {
      var data = JSON.parse(body);
      cb(null, data);
    }
  }
  this.logger.info("Getting datacenter info...");
  libpb.listDatacenters(apiCallback);
}

PbServer.prototype.listServers = function(cb) {
  cb = cb ? cb : dummyCb;
  var apiCallback = function(err, resp, body) {
    if (err) {
      cb(err);
    }
    else {
      var data = JSON.parse(body);
      cb(null, data);
    }
  }
  this.logger.info("Listing servers...");
  libpb.listServers(this.pb.datacenterId, apiCallback)
}

PbServer.prototype.getServer = function(cb) {
  cb = cb ? cb : dummyCb;
  var apiCallback = function(err, resp, body) {
    if (err) {
      cb(err);
    }
    else {
      var data = JSON.parse(body);
      cb(null, data);
    }
  }
  this.logger.info("Getting server status...");
  libpb.getServer(this.pb.datacenterId, this.pb.serverId, apiCallback)
}

PbServer.prototype.startServer = function(cb) {
  this.logger.info("Starting server...");
  libpb.startServer(this.pb.datacenterId, this.pb.serverId, cb)
}

PbServer.prototype.stopServer = function(cb) {
  this.logger.info("Powering off server...");
  libpb.stopServer(this.pb.datacenterId, this.pb.serverId, cb)
}

PbServer.prototype.shutdownServer = function(cb) {
  var self = this;
  cb = cb ? cb : dummyCb;
  this.logger.info("Shutting down server...");
  var ssh = new SSH({
    host: this.ssh.host,
    port: this.ssh.port,
    user: this.ssh.user,
    key: this.sshKey,
  });
  var exit = function(code, stdout, stderr) {
    self.logger.debug(format("SSH command exit code: %s", code));
    if (code === 0) {
      cb(null, code);
    }
    else {
      cb(format('returned with error code: %d, %s', code, stderr));
    }
  }
  var execConfig = {
    exit: exit,
  };
  var startConfig = {
    success: function() {
      self.logger.debug("SSH connection successful...");
    },
    fail: function(err) {
      self.logger.debug(format("SSH connection failed: %s", err));
      cb(err);
    },
  }
  ssh.exec('shutdown -P now shutdown-now&', execConfig).start(startConfig);
}

PbServer.prototype.serverStateChange = function(serverToState, vmToState, cb) {
  var self = this;
  cb = cb ? cb : dummyCb;
  var count = 1;
  var checkState = function(err, data) {
    if (err) {
      self.logger.error(format("ERROR: %s", err));
      cb(err);
    }
    else {
      if (count > self.maxStateChangeQueryAttempts) {
        clearInterval(serverStateChange);
        var message = "Max attempts exceeded.";
        self.logger.error(message);
        cb(message);
      }
      else {
        var serverState = data.metadata.state;
        var vmState = data.properties.vmState;
        self.logger.debug(format("Attempt #%d", count));
        self.logger.debug("-------------------------------------");
        self.logger.debug(format("Power state: %s", serverState));
        self.logger.debug(format("Server state: %s", vmState));
        self.logger.debug("-------------------------------------");
        if (serverState == serverToState && vmState == vmToState) {
          self.logger.info(format("State change to (%s, %s) complete", serverToState , vmToState));
          clearInterval(serverStateChange);
          cb(null, data);
        }
        count++;
      }
    }
  }
  var get = function() {
    self.getServer(checkState);
  }
  this.logger.info(format("Waiting for server state to change to (%s, %s)", serverToState , vmToState));
  get();
  var serverStateChange = setInterval(get, this.stateChangeQueryInterval);
}

PbServer.prototype.checkCommand = function(command, cb) {
  var self = this;
  cb = cb ? cb : dummyCb;
  var count = 1;
  // This prevents overlapping checks and messages.
  var timeout = this.stateChangeQueryInterval - 1000;
  this.logger.debug(format("Checking command: %s", command));
  this.logger.debug(format("SSH connection timeout set to %d milliseconds", timeout));
  var exit = function(code, stdout, stderr) {
    if (code === 0) {
      clearInterval(checkCommand);
      self.logger.info("Command succeeded");
      cb(null, code);
    }
    else {
      self.logger.debug(format('Command returned with error code: %d, %s', code, stderr));
    }
  }
  var execConfig = {
    exit: exit,
  };
  var startConfig = {
    success: function() {
      self.logger.debug("SSH connection successful...");
    },
    fail: function(err) {
      self.logger.debug(format("SSH connection failed: %s", err));
    },
  }
  var check = function() {
    if (count > self.maxStateChangeQueryAttempts) {
      clearInterval(checkCommand);
      var message = "Max attempts exceeded.";
      self.logger.error(message);
      cb(message);
    }
    else {
      self.logger.debug(format("Attempt #%d", count));
      var ssh = new SSH({
        host: self.ssh.host,
        port: self.ssh.port,
        user: self.ssh.user,
        key: self.sshKey,
        timeout: timeout,
      });
      ssh.exec(command, execConfig).start(startConfig);
      count++;
    }
  }
  check();
  var checkCommand = setInterval(check, this.stateChangeQueryInterval);
}

if (module.exports) {
  module.exports = PbServer;
}
