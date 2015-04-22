(function() {
  "use strict";
  var app = window.app || {};
  window.app = app;

  app.SERVER = "http://vps.starcatcher.us:9001";

  // Set up WebAudio, bind events and intervals
  app.load = function() {
    app.mount = "";

    // Off-screen canvas
    app.offcanvas = document.createElement("canvas");
    app.offcanvas.width = app.canvas.width;
    app.offcanvas.height = app.canvas.height;
    app.offctx = app.offcanvas.getContext("2d");

    // Initialize WebAudio
    app.context = new AudioContext();

    app.analyser = app.context.createAnalyser();
    app.analyser.fftSize = 1024;
    app.analyser.connect(app.context.destination);

    app.player = new Audio();
    app.player.crossOrigin = "anonymous";
    app.source = app.context.createMediaElementSource(app.player);
    app.source.connect(app.analyser);

    // Frequency- and time-domain data
    app.freqdata = new Uint8Array(app.analyser.frequencyBinCount);
    app.timedata = new Uint8Array(app.analyser.fftSize);

    // Update the hash
    app.updateHash();
    setInterval(app.updateHash, 300);

    // Update the metadata and station selection
    app.updateData();
    setInterval(app.updateData, 5000);

    // Load a random effect
    app.loadEffect();

    // Toggle the station selector
    $("#meta").on("click", app.toggleSelector);
  };

  // Set the station mount if the hash was modified
  app.updateHash = function() {
    var hmount = window.location.hash.substr(1);

    if (hmount == "" && app.mount != "")
      app.setMount();
    else if (app.mount != hmount)
      app.setMount(hmount);
  };

  // Show or hide the station selector
  app.toggleSelector = function(state) {
    if (state != false && state != true) {
      state = !$("#stations").is(":visible");
    }
    if (state) {
      $({
        "alpha": 0,
        "width": $("#meta-inner").width() + 10
      }).animate({
        "alpha": 1,
        "width": 500
      }, {
        step: function() {
          $("#meta").css({
            "border-right-color": "rgba(255,255,255," + this.alpha + ")",
            "width": this.width
          });
        },
        complete: function() {
          $("#meta").css({
            "border-right-color": "rgba(255,255,255,1)",
            "width": 500
          });
          $("#stations").slideDown();
        }
      });

    } else {
      $("#stations").slideUp(function() {
        $("#meta").animateAuto("width", function() {
          $(this).css("width", "auto");
        });
        $({
          "alpha": 1,
        }).animate({
          "alpha": 0,
        }, {
          step: function() {
            $("#meta").css({
              "border-right-color": "rgba(255,255,255," + this.alpha + ")",
            });
          },
          complete: function() {
            $("#meta").css("border-right-color", "rgba(255,255,255,0)");
          }
        });
      });
    }
  }

  // Load a effect from an object
  app.loadEffect = function(obj) {
    if (app.effect && app.effect.unload)
      app.effect.unload();

    if (!obj) {
      var n = chooseProperty(app.effects);
      obj = app.effects[n];
    }
    
    app.effect = obj;
    if (obj.hasOwnProperty("load") && obj.load)
      obj.load();
  };

  // Load a effect from a JSON string
  app.loadEffectFromJSON = function(json) {
    var obj;
    try {
      obj = JSON.parse(json, function (k, v) {
        if (v
            && typeof v === "string"
            && v.substr(0,8) == "function") {
            var startBody = v.indexOf('{') + 1;
            var endBody = v.lastIndexOf('}');
            var startArgs = v.indexOf('(') + 1;
            var endArgs = v.indexOf(')');

            return new Function(v.substring(startArgs, endArgs),
              v.substring(startBody, endBody));
        }
        return v;
      });
    } catch (e) {
      console.error("Error while parsing effect JSON", e);
      return false;
    }
    app.loadEffect(new app.effect(obj));
    return true;
  };

  // Load a effect from a Icecast description string
  app.loadEffectFromDescription = function(desc, failcb) {
    var m = desc.match(/icedrop:(.+|\n+)/m);
    if (!m) {
      failcb();
      return;
    }
    m = m[1];

    if (m.match(/^\w+$/)) {
      // Load effect by name
      console.log("Station requested loading effect by name:", m);
      if (app.effects.hasOwnProperty(m))
        app.loadEffect(app.effects[m]);
      else
        failcb();
    } else if (m.match(/^(?:https?:\/\/)?(?:[\w]+\.)(?:\.?[\w]{2,})+$/)) {
      // Load effect from URL
      console.log("Station requested loading effect from URL:", m);
      $.get(m, function(data) {
        if (!app.loadEffectFromJSON(data))
          failcb();
      }, failcb);
    } else {
      // Load effect from direct JSON
      console.log("Station requested loading effect from JSON:", m);
      if (!app.loadEffectFromJSON(m))
        failcb();
    }
  };

  // Set the current station by mount point
  app.setMount = function(mount) {
    if (mount) {
      if (app.mount != mount) {
        console.log("Switched station mount to", mount);

        app.mount = mount;
        // Load the new stream
        app.player.setAttribute("src", app.SERVER + "/" + mount);
        app.player.load();
        app.player.play();

        // Update the hash
        var hmount = window.location.hash.substr(1);
        if (hmount != mount)
          window.location.hash = "#" + mount;

        app.toggleSelector(false);

        // Try to load a effect if existant
        app.updateData(function(station, data) {
          if (station && station.hasOwnProperty("server_description")) {
            var success = app.loadEffectFromDescription(station.server_description,
              function() {
                // Error or not even requested, load random effect instead
                app.loadEffect(app.effects["rose"]);
              });
          }
        });
      }
    } else {
      if (app.mount != "") {
        console.log("Switched station mount to none");

        app.mount = "";
        app.player.pause();

        // Update the hash
        var hmount = window.location.hash.substr(1);
        if (hmount != "")
          window.location.hash = "";

        app.toggleSelector(true);
        app.updateData();
      }
    }
  };

  // Request data from the Icecast API and update everything that uses it
  // The current station and the full data will be passed to the callback
  app.updateData = function(cb) {
    $.getJSON(app.SERVER + "/status-json.xsl", function(data) {
      var current, ids = [];

      $.each(data.icestats.source, function(i, v) {
        var mount = v.listenurl.match(/\/([^\/]+)$/)[1];
        var id = mount.replace(/[^\w]/g, "");

        ids.push(id);

        // Find existing station element or create it
        var el = $(".station#" + id);
        if (el.length == 0) {
          // Clone the template element
          el = $(".station#template")
            .clone()
            .attr("id", id)
            .appendTo("#stations").hide().fadeIn()
            .on("click", function(e) {
              $(".station").removeClass("current");
              $(this).addClass("current");
            });
        }

        // Update station informations
        el.attr("href", "#" + mount);
        el.find(".station-name").text(v.server_name || ("/" + mount));
        el.find(".station-listeners").text(v.listeners);
        el.find(".station-title").text(v.title || "Unknown");
        el.find(".station-artist").text(v.artist || "Unknown");

        // Found the station that is currently being listened to
        if (mount == app.mount) {
          current = v;
          el.addClass("current");
        }
      });

      // Clean up stations that have gone offline since the last update
      $(".station").each(function(i, v) {
        var el = $(v);
        var id = el.attr("id");

        if (ids.indexOf(id) == -1 && id != "template") {
          el.fadeOut(function() {
            el.remove();
          });
        }
      });

      if (!current && app.mount != "") {
        // Station probably disconnected
        console.log("Current station disconnected");
        $(".station.current").fadeOut(function() {
          $(this).remove();
        });
        app.setMount();
        app.updateData();

      } else if (current) {
        // Update current station informations
        $("#meta-listeners").text(current.listeners);
        $("#meta-title").text(current.title || "Unknown");
        $("#meta-artist").text(current.artist || "Unknown");
      }

      if (cb)
        cb(current, data.icestats);
    });
  };

  // Viewport has been resized
  app.resize = function(w, h) {
    app.offcanvas.width = w;
    app.offcanvas.height = h;

    if (app.effect.resize)
      app.effect.resize(w, h);
  };

  // Get the current frequency- and time-domain data
  app.update = function(dt) {
    app.analyser.getByteFrequencyData(app.freqdata);
    app.analyser.getByteTimeDomainData(app.timedata);

    if (app.effect.update)
      app.effect.update(dt);
  };

  // Draw the visualization
  app.draw = function() {
    var w = app.canvas.width, h = app.canvas.height;
    if (app.effect.draw)
      app.effect.draw(w, h);
  };

})();
