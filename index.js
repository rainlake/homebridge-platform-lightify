var moment = require('moment');
var util = require('util');
var lightify = require('node-lightify');
var Service, Characteristic;
var Lightbulb, Outlet;

'use strict';

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    
    Lightbulb = function(displayName, subtype) {
        Service.call(this, displayName, '00000043-0000-1000-8000-0026BB765291', subtype);
        this.addCharacteristic(Characteristic.On);
        
        this.addOptionalCharacteristic(Characteristic.Name);
    };
    util.inherits(Lightbulb, Service);
    Lightbulb.UUID = '00000043-0000-1000-8000-0026BB765291';

    Outlet = function(displayName, subtype) {
        Service.call(this, displayName, '00000047-0000-1000-8000-0026BB765291', subtype);
        this.addCharacteristic(Characteristic.On);

        this.addOptionalCharacteristic(Characteristic.Name);
    };
    util.inherits(Outlet, Service);
    Outlet.UUID = '00000047-0000-1000-8000-0026BB765291';

    homebridge.registerPlatform("homebridge-platform-lightify", "Lightify", LightifyPlatform);
}


function HSVtoRGB(h, s, v) {
    var r, g, b, i, f, p, q, t;
    if (arguments.length === 1) {
        s = h.s, v = h.v, h = h.h;
    }
    i = Math.floor(h * 6);
    f = h * 6 - i;
    p = v * (1 - s);
    q = v * (1 - f * s);
    t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }
    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };
}
/* accepts parameters
 * r  Object = {r:x, g:y, b:z}
 * OR 
 * r, g, b
*/
function RGBtoHSV(r, g, b) {
    if (arguments.length === 1) {
        g = r.g, b = r.b, r = r.r;
    }
    var max = Math.max(r, g, b), min = Math.min(r, g, b),
        d = max - min,
        h,
        s = (max === 0 ? 0 : d / max),
        v = max / 255;

    switch (max) {
        case min: h = 0; break;
        case r: h = (g - b) + d * (g < b ? 6: 0); h /= 6 * d; break;
        case g: h = (b - r) + d * 2; h /= 6 * d; break;
        case b: h = (r - g) + d * 4; h /= 6 * d; break;
    }

    return {
        h: h,
        s: s,
        v: v
    };
}
function LightifyPlatform(log, config) {
    this.config = config;
    this.log = log;
}
LightifyPlatform.prototype.refreshTimer = function() {
    var self = this;
    setTimeout(function() {
        var connection = new lightify.lightify(self.config.bridge_ip, self.log);
        connection.connect().then(function() {
            self.log.info('Connected to Lightify Bridge');
            return connection.discover();
        }).then(function(data) {
            self.log.info('Discover Success');
            data.result.forEach(function(light) {
                var assc = self.foundAccessories.find(function(assc) {
                    return assc.device && assc.device.mac == light.mac;
                });
                if(assc) {
                    assc.updateDevice(light);
                }
            });            
            connection.dispose();
        }).catch(function(error) {
            self.log.info('Discover Failed');
            self.log.error(error);
        });
        self.refreshTimer();
    }, 30 * 1000);
}
LightifyPlatform.prototype.accessories = function(callback) {
    var self = this;
    var connection = new lightify.lightify(this.config.bridge_ip, self.log);
    connection.connect().then(function() {
        self.log.info('Connected to Lightify Bridge');
        return connection.discover();
    }).then(function(data) {
        self.log.info('Discovered devices');
        self.foundAccessories = [];
        data.result.forEach(function(light) {
            if(light.type && lightify.isLight(light.type)) {
                self.log.info('Lightify Light [%s]', light.name);
                self.foundAccessories.push(new LightifyAccessory(self, light));
            } else if (light.type && lightify.isPlug(light.type)) {
                self.log.info('Lightify Bulb [%s]', light.name);
                self.foundAccessories.push(new LightifyOutlet(self, light));
            }
        });
        connection.dispose();
        callback(self.foundAccessories);
        self.refreshTimer();
    }).catch(function(error) {
        self.log.info('Discovered failed', error);
        throw 'can not connect to lightify bridge.';
    });
}
function LightifyAccessory(platform, device) {
    this.log = platform.log;
    this.device = device;
    this.name = device.name;
    this.platform = platform;
    
    this.service = new Lightbulb(device.name);
    
    this.service.getCharacteristic(Characteristic.Name).value = device.name;
    this.service.getCharacteristic(Characteristic.On).value = device.status;
    
    var self = this;
    if(lightify.isColorSupported(device.type)) {
        this.colorBulb(platform);
    }
    if (lightify.isBrightnessSupported(device.type)) {
        
        this.service.addOptionalCharacteristic(Characteristic.Brightness);
        this.service.getCharacteristic(Characteristic.Brightness).value = self.device.brightness;
        this.service.getCharacteristic(Characteristic.Brightness)
        .on('get', function(callback) {
            callback(null, self.device.brightness);
        })
        .on('set', function(brightness, callback) {
            if(self.setBrightnessTimer) {
                clearTimeout(self.setBrightnessTimer);
            }
            self.setBrightnessTimer = setTimeout(function() {
                var connection = new lightify.lightify(platform.config.bridge_ip, self.log);
                connection.connect().then(function() {
                    return connection.nodeBrightness(self.device.mac, brightness);
                }).then(function() {
                    self.device.brightness = brightness;
                    return connection.dispose();
                }); 
            }, 80);
            callback(null);
        });
    }

    this.service.getCharacteristic(Characteristic.On)
        .on('get', function(callback) {
            callback(null, self.device.online == 2 && self.device.status);
        })
        .on('set', function(state, callback) {
            var connection = new lightify.lightify(platform.config.bridge_ip, self.log);
            connection.connect().then(function() {
                return connection.nodeOnOff(self.device.mac, state ? true : false);
            }).then(function() {
                self.device.status = state;
                callback(null);
                return connection.dispose();
            }).catch(function() {
                callback(null);
                return connection.dispose();
            });
        });
}
LightifyAccessory.prototype.setHSV = function(hsv) {
    var rgb = HSVtoRGB(hsv.h, hsv.s, hsv.v);

    this.device.red = rgb.r;
    this.device.green = rgb.g;
    this.device.blue = rgb.b;
    
    var self = this;
    if(this.setHSVTimer) {
        clearTimeout(this.setHSVTimer);
    }
    this.setHSVTimer = setTimeout(function() {
        var connection = new lightify.lightify(self.platform.config.bridge_ip, self.log);
    
        connection.connect().then(function() {
            return connection.nodeColor(self.device.mac,
                self.device.red, self.device.green, self.device.blue, self.device.alpha);
        }).then(function() {
            return connection.dispose();
        });
    }, 100);
    
}
LightifyAccessory.prototype.colorBulb = function(platform) {
    this.service.addOptionalCharacteristic(Characteristic.Hue);
    this.service.addOptionalCharacteristic(Characteristic.Saturation);
    this.service.addOptionalCharacteristic(Characteristic.Brightness);
    
    var hsv = RGBtoHSV(this.device.red, this.device.green, this.device.blue);

    this.service.getCharacteristic(Characteristic.Hue).value = hsv.h * 360;
    this.service.getCharacteristic(Characteristic.Saturation).value = hsv.h * 100;
    this.service.getCharacteristic(Characteristic.Brightness).value = hsv.v * 100;
    
    var self = this;
    this.service.getCharacteristic(Characteristic.Hue)
    .on('get', function(callback) {
        hsv = RGBtoHSV(self.device.red, self.device.green, self.device.blue);
        callback(null, hsv.h * 360);
    })
    .on('set', function(h, callback) {
        hsv = RGBtoHSV(self.device.red, self.device.green, self.device.blue);
        hsv.h = h / 360.0;
        self.setHSV(hsv);
        callback(null);
    });
    
    this.service.getCharacteristic(Characteristic.Saturation)
    .on('get', function(callback) {
        hsv = RGBtoHSV(self.device.red, self.device.green, self.device.blue);
        callback(null, hsv.s * 100);
    })
    .on('set', function(s, callback) {
        hsv = RGBtoHSV(self.device.red, self.device.green, self.device.blue);
        hsv.s = s / 100.0;
        self.setHSV(hsv);
        callback(null);
    });
}
LightifyAccessory.prototype.updateDevice = function(device) {
    this.device = device;
}

LightifyAccessory.prototype.getServices = function() {
    var services = [];
    var service = new Service.AccessoryInformation();
    service.setCharacteristic(Characteristic.Name, this.name)
        .setCharacteristic(Characteristic.Manufacturer, 'Lightify')
        .setCharacteristic(Characteristic.Model, 'Lightify')
        .setCharacteristic(Characteristic.SerialNumber, '')
        .setCharacteristic(Characteristic.FirmwareRevision, '1.0.0')
        .setCharacteristic(Characteristic.HardwareRevision, '1.0.0');
    services.push(service);
    if(this.service) {
        services.push(this.service);
    }
    return services;
}
function LightifyOutlet(platform, device) {
    this.log = platform.log;
    this.device = device;
    this.name = device.name;
    this.platform = platform;
    
    this.service = new Outlet(device.name);
    
    this.service.getCharacteristic(Characteristic.Name).value = device.name;
    this.service.getCharacteristic(Characteristic.On).value = device.status;
    
    var self = this;
    this.service.getCharacteristic(Characteristic.On)
        .on('get', function(callback) {
            callback(null, self.device.online == 2 && self.device.status);
        })
        .on('set', function(state, callback) {
            var connection = new lightify.lightify(platform.config.bridge_ip, self.log);
            connection.connect().then(function() {
                return connection.nodeOnOff(self.device.mac, state ? true : false);
            }).then(function() {
                self.device.status = state;
                callback(null);
                return connection.dispose();
            }).catch(function() {
                callback(null);
                return connection.dispose();
            });           
        });
}
LightifyOutlet.prototype.updateDevice = function(device) {
    this.device = device;
}
LightifyOutlet.prototype.getServices = function() {
    var services = [];
    var service = new Service.AccessoryInformation();
    service.setCharacteristic(Characteristic.Name, this.name)
        .setCharacteristic(Characteristic.Manufacturer, 'Lightify')
        .setCharacteristic(Characteristic.Model, 'Lightify Outlet')
        .setCharacteristic(Characteristic.SerialNumber, '')
        .setCharacteristic(Characteristic.FirmwareRevision, '1.0.0')
        .setCharacteristic(Characteristic.HardwareRevision, '1.0.0');
    services.push(service);
    if(this.service) {
        services.push(this.service);
    }
    return services;
}
