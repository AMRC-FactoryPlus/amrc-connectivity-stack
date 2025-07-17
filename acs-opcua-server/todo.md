- Anon auth is currently enabled to make debugging easier
- Reintroduce required auth but ensure actually [checks auth](https://amrcimg.slack.com/archives/C02PLU14UCT/p1752744578036589)
- Permissions aren't based on MQTT access and should be
- Multiple parent folders are made (e.g. 5 Axes folder each with one 
  axis in)
- Double check that changes to InfluxDB are reflected in the address
  space