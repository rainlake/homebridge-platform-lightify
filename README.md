# OSRAM Lightify Platform for homebridge
This is an OSRAM Lightify plugin for [homebridge](https://github.com/nfarina/homebridge).

## Setup
1. Add via `npm install -g homebridge-platform-lightify-mg`
2. Add to the homebridge config.json in the `platforms` section
```json
{
  "platform": "Lightify",
  "bridge_ip": "x.x.x.x",
  "name" : "Lightify",
  "showGroups" : true,
  "hideNodes" : false
}
```  
bridge_ip: ip address of your lightify bridge/hub  
showGroups: defaults to `false`  
hideNodes: defaults to `false`  
All other fields are required

## About
This plugin uses the proprietary lightify protocol that the hub uses to commnicate with the lights, rather than the JSON API provided by lightify.

This plugin works with all Lightify products including Tunable White bulbs and outlets.  Sensors are not supported, but are hidden.

Please report any issues on github.
