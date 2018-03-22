var moment = require('moment');
var util = require('util');
var lightify = require('node-lightify');
var Service, Characteristic;
var Lightbulb;

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
function temperatureToHue(temperature) {
    return (temperature - 1000 / 7000.0) * 180.0;
}
function hueToTemperature(hue) {
    var ctemp;
    if (hue <= 180){
        ctemp = ((hue/180.0)*7000.0)+1000.0;
    } else {
        ctemp = (((180-(hue-180))/180.0)*7000.0)+1000.0;
    }
    return ctemp;
}
function LightifyPlatform(log, config) {
    this.config = config;
    this.log = log;
}
LightifyPlatform.prototype.refreshTimer = function(timeout) {
    var self = this;
    setTimeout(function() {
        var connection = new lightify.lightify(self.config.bridge_ip, self.log);
        self.discover(connection).then(function(data) {
            self.log.debug('Discover Success');
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
        self.refreshTimer(30);
    }, (timeout || 30) * 1000);
}
LightifyPlatform.prototype.discover = function(connection) {
    var self = this;
    return connection.connect().then(function() {
        self.log.debug('Connected to Lightify Bridge');
        //have to discover nodes for light status of group
        return connection.discover();
    }).then(function(data) {
        return !self.config.showGroups ? Promise.resolve(data) :
        new Promise(function(resolve, reject) {
            connection.discoverZone()
            .then(function(zones) {
                //get zone info. if one of them is off, then this group is off
                zones.result.reduce(function(av, zone){
                    return av.then(function() {
                        return connection
                        .getZoneInfo(zone.id)
                        .then(function(zoneInfo){
                            zone.online = 2; // group always online
                            zone.status = 0; // default to off
                            zone.isBrightnessSupported = false;
                            zone.isColorSupported = false;
                            zone.isTemperatureSupported = false;
                            if(!zoneInfo.result || zoneInfo.result.length == 0) {
                                return Promise.reject('no result for zone');
                            }
                            for (var mac of zoneInfo.result[0].devices) {
                                var device = data.result.find(function(d) {
                                    return d.mac === mac;
                                });
                                if (device && device.online && device.status === 1) {
                                    zone.status = 1;
                                    self.log.debug('Lightify Zone is on');
                                }
                                if(device && lightify.isBrightnessSupported(device.type)) {
                                    zone.isBrightnessSupported = true;
                                    zone.brightness = device.brightness;
                                    self.log.debug('Lightify Zone support brightness, current brightness=[%d]', device.brightness);
                                }
                                if(device && lightify.isColorSupported(device.type)) {
                                    zone.isColorSupported = true;
                                    zone.red = device.red;
                                    zone.green = device.green;
                                    c = device.blue;
                                    self.log.debug('Lightify Zone support color, current red=[%d], green=[%d], blue=[%d]', device.red, zone.green, zone.blue);
                                }
                                if(device && lightify.isTemperatureSupported(device.type)) {
                                    zone.isTemperatureSupported = true;
                                    zone.temperature = device.temperature;
                                    self.log.debug('Lightify Zone support temperature, current temperature=[%d]', device.temperature);
                                }
                            }
                            return Promise.resolve();
                        });
                    });
                }, Promise.resolve())
                .then(function() {
                    Array.prototype.push.apply(data.result, zones.result);
                    resolve(data);
                })
                .catch(function(error) {
                    reject(error);
                });
            })
            .catch(function(error) {
                reject(error);
            });
        });
    });
}
LightifyPlatform.prototype.accessories = function(callback) {
    var self = this;
    var connection = new lightify.lightify(this.config.bridge_ip, self.log);
    this.discover(connection).then(function(data) {
        self.foundAccessories = [];
        data.result.forEach(function(light) {
            if(!self.config.hideNodes && light.type && lightify.isLight(light.type)) {
                self.log.info('Lightify Light [%s]', light.name);
                self.foundAccessories.push(new LightifyAccessory(self, light));
            } else if (!self.config.hideNodes && light.type && lightify.isPlug(light.type)) {
                self.log.info('Lightify Bulb [%s]', light.name);
                self.foundAccessories.push(new LightifyOutlet(self, light));
            } else if(!light.type) {
                self.foundAccessories.push(new LightifyAccessory(self, light));
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

    this.service = new Lightbulb(device.name || 'Unknown');

    this.service.getCharacteristic(Characteristic.Name).value = device.name;
    this.service.getCharacteristic(Characteristic.On).value = device.status;

    var self = this;
    if(device.isColorSupported || lightify.isColorSupported(device.type)) {
        this.colorBulb(platform);
    } else if (device.isTemperatureSupported || lightify.isTemperatureSupported(device.type)) {
        this.temperatureBulb(platform);
    }
    if (device.isBrightnessSupported || lightify.isBrightnessSupported(device.type)) {
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
                    return connection.nodeBrightness(self.device.mac, brightness, 0, self.device.type ? false : true);
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
                return connection.nodeOnOff(self.device.mac, state ? true : false, self.device.type ? false : true);
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
                self.device.red, self.device.green, self.device.blue, self.device.alpha, 0, self.device.type ? false : true);
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
LightifyAccessory.prototype.temperatureBulb = function(platform) {
    this.service.addOptionalCharacteristic(Characteristic.Hue);
    this.service.addOptionalCharacteristic(Characteristic.Saturation);
    this.service.addOptionalCharacteristic(Characteristic.Brightness);

    this.log.error('temperatureBulb');
    var hsv = temperatureToHue(this.device.temperature);

    var self = this;
    this.service.getCharacteristic(Characteristic.Hue)
    .on('get', function(callback) {
        self.log.error('get temperature:', self.device.temperature);
        h = hueToTemperature(self.device.temperature)
        self.log.error('get Hue:', h);
        callback(null, 1);
    })
    .on('set', function(hue, callback) {
        self.log.error('sent hue to set: ', hue);
        var temperature = hueToTemperature(hue);
        var connection = new lightify.lightify(platform.config.bridge_ip, self.log);
        connection.connect().then(function() {
            return connection.nodeTemperature(self.device.mac, temperature, 0, self.device.type ? false : true).then(function(data) {
                self.log.error('set temperature (via hue): ', temperature); 
                self.device.temperature = temperature;
                callback(null, 1);
                return connection.dispose();
            });
        });
    });

    this.service.getCharacteristic(Characteristic.Saturation)
    .on('get', function(callback) {
        self.log.error('get Saturation');
        callback(null, 1);
    })
    .on('set', function(s, callback) {
        self.log.error("Saturation: ", s);
        callback(null, true);
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
        .setCharacteristic(Characteristic.SerialNumber, this.device.friendlyMac)
        .setCharacteristic(Characteristic.FirmwareRevision,
            ((this.device.firmware_version >> 24) & 0xFF) + '.' +
            ((this.device.firmware_version >> 16) & 0xFF) + '.' +
            ((this.device.firmware_version >> 8) & 0xFF) + '.' +
            (this.device.firmware_version & 0xFF)
        )
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

    this.service = new Service.Outlet(device.name);

    this.service.getCharacteristic(Characteristic.Name).value = device.name;
    this.service.getCharacteristic(Characteristic.On).value = device.status;
    this.service.getCharacteristic(Characteristic.OutletInUse).value = true;

    var self = this;
    this.service.getCharacteristic(Characteristic.OutletInUse)
    .on('get', function(callback) {
        callback(null, true);
    });
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
