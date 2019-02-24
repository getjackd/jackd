# jackd

[![Build Status](https://img.shields.io/circleci/project/github/divmgl/jackd/master.svg)](https://circleci.com/gh/divmgl/jackd/tree/master)

**This project is currently WIP. Do not use until version 1**.

```js
/* producer.js */
const Jackd = require('jackd')
const beanstalkd = new Jackd()

await beanstalkd.put('Hello world!')

/* consumer.js */
const job = await beanstalkd.reserve()
// => { id: '1', payload: 'Hello world!' }

// ...process the job... then:
await beanstalkd.delete(job.id)
```

## Why

Most beanstalkd clients don't support promises (fivebeans, nodestalker) and the ones that do have too many dependencies (node-beanstalkd-client). This package has:

- An easy to use API that returns objects instead of strings
- Native promise support
- No dependencies

## API

The author of beanstalkd has a [good write-up of the beanstalkd protocol](https://github.com/beanstalkd/beanstalkd/blob/master/doc/protocol.txt), which makes it incredibly easy to development against. If you're unsure how beanstalkd works, it may be worth reading the specs before the API docs.

### Overview

beanstalkd is a simple and blazing fast work queue. Producers connected through TCP sockets (by default on port `11300`) send in jobs to be processed at a later time by a consumer.

All code samples in this API documentation are preceded by

```
const Jackd = require('jackd')
const beanstalkd = new Jackd()
```

#### Connecting and disconnecting

```
await beanstalkd.connect() // Connects to localhost:11300
await beanstalkd.connect({ host, port })

await beanstalkd.disconnect()
// You can also use beanstalkd.close; it's an alias
```

### Producers

#### Adding jobs into a tube

Jobs are simply payloads with a job ID attached. All payloads are ASCII encoded strings. Please keep this in mind if you need to send in special UTF-8 characters in your payloads.

`jackd` will automatically convert an `Object` into a `String` for you using `JSON.stringify`.

```
const jobId = await beanstalkd.put({ foo: 'bar' })
```

You can also just pass in a `String`.

```
const jobId = await beanstalkd.put('my long running job')
```

All jobs sent to beanstalkd have a priority, a delay, and TTR (time-to-run) specification. By default, all jobs are published with `0` priority, `0` delay, and `60` TTR, which means consumers will have 60 seconds to finish the job after reservation. You can override these defaults:

```
await beanstalkd.put({ foo: 'bar' }, {
  delay: 100,
  priority: (new Date()).getTime(),
  ttr: 600
})
```

Jobs with lower priorities are handled first. Refer to [the protocol specs](https://github.com/beanstalkd/beanstalkd/blob/master/doc/protocol.txt#L126) for more information on job options.

#### Using different tubes

All jobs are added to the `default` tube by default. You can change the tube you want to produce a job in by using `use`.

```
await beanstalkd.use('foo')
await beanstalkd.put({ foo: 'bar' })
```

### Consumers

#### Reserving a job

Consumers work by reserving jobs in a tube. Reserving is a blocking operation and execution will stop until a job has been reserved.

```
const { id, payload } = await beanstalkd.reserve()
console.log({ id, payload }) // => { id: '1', payload: '{"foo":"bar"}' }
```

`jackd` will return the payload as-is. This means you'll have to do `JSON.parse` yourself if you passed in an object.

#### Performing job operations (delete/bury/touch)

Once you've reserved a job, there are several operations you can perform on it. The most common operation will be deleting the job after the consumer is finished processing it.

```
await beanstalkd.delete(id)
```

However, you may want to bury the job to be processed later under certain conditions. Buried jobs will not be processed until they are kicked.

```
await beanstalkd.bury(id)
// ... some time later ...
await beanstalkd.kickJob(id)
```

You'll notice that the kick operation is suffixed by `Job`. This is because there is a `kick` command in beanstalkd which will kick a certain number of jobs back into the tube.

```
await beanstalkd.kick(10) // 10 buried jobs will be moved to a ready state
```

Sometimes, consumers will need additional time to run jobs. You can `touch` those jobs to let beanstalkd know you're still processing them.

```
await beanstalkd.touch(id)
```

## Upcoming

- [x] First-class methods for all commands without YAML
- [ ] Worker pattern support
- [ ] Completed test suite
- [ ] API documentation
- [ ] Examples

## License

MIT
