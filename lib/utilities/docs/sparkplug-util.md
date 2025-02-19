# Sparkplug utility classes

These classes help with manipulating Sparkplug packets.

In the Sparkplug spec, a Node is identified by Group ID and Node ID, both strings. A Device is additionally identified by Device ID. These classes unify these into a 'Sparkplug Address', represented as a single string in one of these formats:

```
Group-ID/Node-ID
Group-ID/Node-ID/Device-ID
```

## Address

This class represents a Sparkplug address.

### Constructors

```js
addr = new Address(group, node, device);
addr = Address.parse("Group/Node/Device");
```

Calling the constructor explicitly allows passing the pieces of the address individually. The `Address.parse` static method builds an Address from a single string.

Omitting `device`, or passing `null` or the empty string, creates a Node address.

### Methods

#### `equals`

```js
addr1.equals(addr2)
```

Returns `true` if the two objects represent the same address.

#### `matches`

```js
pattern.matches(addr)
```

Test if `addr` matches `pattern`. Any part of the pattern which is the string `"+"` will match any string (but not no string at all) in the tested address. (The `#` MQTT wildcard is not supported.)

#### `toString`

```js
addr.toString()
```

Stringifies the address in `Group/Node/Device` format.

#### `isDevice`

```js
addr.isDevice()
```

Returns `true` if this is a Device address rather than a Node address.

#### `topic`

```js
topic = addr.topic(type);
```

Returns a string containing an MQTT topic for this address. The type is one of `BIRTH`, `DEATH`, `DATA`, `CMD` or `+` to represent a wildcard type for MQTT subscription. Note that the initial `N` or `D` is added automatically.

#### `parent_node`

```js
parent = addr.parent_node();
```

Returns an Address representing the Node part of this address. If the Address already represents a Node it returns a new object representing the same address.

#### `child_device`

```js
child = addr.child_device(device);
```

If this is a Node address it returns the Address of a child Device.

#### `is_child_of`

```js
device.is_child_of(node)
```

Returns `true` if the `device` address is a child of the `node`.

## Topic

Represents an MQTT topic derived from a Sparkplug address.

### Constructors

```js
topic = new Topic(address, type);
```

Builds a new Topic from an Address and a topic type. The type is one of `BIRTH`, `DEATH`, `DATA`, `CMD` or `+` to represent a wildcard topic (for MQTT subscription). Do not include the initial `N` or `D`.

```js
topic = Topic.parse("...");
```

Parse a string containing an MQTT topic name and return a Topic object. Returns `null` if the string is not a valid Sparkplug topic.

### Methods

#### `toString`

```js
topic.toString()
```

Returns a string containing the topic name.

## MetricBuilder

This is not a class but a static object containing functions for building common sets of metrics.

### Birth certificates

```js
MetricBuilder.birth.node(metrics);
MetricBuilder.birth.device(metrics);
MetricBuilder.birth.command_escalation(metrics);
```

The `metrics` parameter should be an array of metrics as might be passed to `SpB.encodePayload`. If it is omitted an empty array will be used. Adds metrics to the array appropriate for the birth certificate of a Node, the birth certificate of a Device, or a device which wants to perform command escalation, as appropriate.

Returns the array of metrics.

### Death certificates

```js
MetricBuilder.death.node(metrics);
```

The `metrics` parameter is as above. Creates death certificate suitable for a Node.

### Command escalation

```js
const req = MetricBuilder.data.command_escalation(addr, metric, value);
```

Returns an array of metrics requesting a Factory+ command escalation. This should be published as part of one of your DATA packets. (If you need command escalation consider using the HTTP interface instead.)

```js
const rsp = MetricBuilder.cmd.command_escalation_response(addr, metric, status);
```

Build a command escalation response. For use by the command escalation service only.

## MetricTree

```js
tree = new MetricTree(payload);
```

Build a tree of metrics from the supplied payload; this should be a parsed payload as returned from `SpB.decodePayload`.

```
A
B/C
B/D
B/D/E
```

Given a packet containing the above metrics the return value will look like below, where the `{...}` represents the original metric objects from the Sparkplug payload.

```
[MetricTree] {
    A: {...},
    B: [MetricBranch] {
        C: {...},
        D: [MetricBranch] {
            $metric: {...},
            E: {...},
        },
    },
}
```

Note in particular that where a metric is present as both leaf and branch that the leaf value is put on the `$metric` property of the MetricBranch object.