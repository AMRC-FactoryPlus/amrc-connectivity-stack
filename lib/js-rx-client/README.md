# Factory+ Rx service client

This module provides extensions to the ServiceClient class provided by
`@amrc-factoryplus/service-client`. These extensions support prompt
notification of changes to service state by using `rxjs` Observables.

## Usage

Import the RxClient class and create a client object. All parameters to
the RxClient constructor are as for the base ServiceClient.

```js
import process from "process";
import { RxClient, UUIDs } from "@amrc-factoryplus/rx-client";

# Use configuration from the environment
const client = new RxClient({ env: process.env });

# Use explicit configuration
const client = new RxClient({
    directory_url:  "https://directory.my-fplus.example",
    username:       "...",
    password:       "...",
    verbose:        "ALL",
});

# Create and subscribe to an Observable
const sub = client.ConfigDB
    .search_app(UUIDs.App.Info)
    .subscribe(val => console.log(val.toJS()));
```
