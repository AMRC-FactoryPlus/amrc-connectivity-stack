This library `@amrc-factoryplus/service-client` contains the **JavaScript client SDK** used by applications and services to talk to Factory+ infrastructure services. 

There is a central base service client fplus

responsible for:
- connection setup
- authentication/session handling
- HTTP requests
- MQTT broker access


```
    const fplus = new ServiceClient(...)
```

And then, there are sub-services that hang off it:
```
    fplus.ConfigDB
    fplus.Auth
    ...
```

