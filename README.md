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

Most `beanstalkd` clients don't support promises (fivebeans, nodestalker) and the ones that do have too many dependencies (node-beanstalkd-client). This package has:

- A concise and easy to use API
- Native promise support
- No dependencies

## API

The author of `beanstalkd` has a [good write-up of the `beanstalkd` protocol](https://github.com/beanstalkd/beanstalkd/blob/master/doc/protocol.txt), which makes it incredibly easy to development against. If you're unsure how `beanstalkd works, it may be worth reading the specs before the API docs.

### Overview

`beanstalkd` is a simple and blazing fast work queue. Producers connected through TCP sockets (by default on port `11300`) send in jobs to be processed at a later time by a consumer.

#### Connecting and disconnecting

```js
const Jackd = require('jackd')
const beanstalkd = new Jackd()

await beanstalkd.connect() // Connects to localhost:11300
await beanstalkd.connect({ host, port })

await beanstalkd.disconnect() // You can also use beanstalkd.close; it's an alias
```

### Producers

#### Adding jobs into a tube

Jobs are simply payloads with a job ID attached. All payloads are ASCII encoded strings. Please keep this in mind if you need to send in special UTF-8 characters in your payloads.

`jackd` will automatically convert an `Object` into a `String` for you using `JSON.stringify`.

```js
const jobId = await beanstalkd.put({ foo: 'bar' })
```

You can also just pass in a `String`.

```js
const jobId = await beanstalkd.put('my long running job')
```

All jobs sent to beanstalkd have a priority, a delay, and TTR (time-to-run) specification. By default, all jobs are published with `0` priority, `0` delay, and `60` TTR, which means consumers will have 60 seconds to finish the job after reservation. You can override these defaults:

```js
await beanstalkd.put(
  { foo: 'bar' },
  {
    delay: 2, // Two second delay
    priority: new Date().getTime(),
    ttr: 600 // Ten minute delay
  }
)
```

Jobs with lower priorities are handled first. Refer to [the protocol specs](https://github.com/beanstalkd/beanstalkd/blob/master/doc/protocol.txt#L126) for more information on job options.

#### Using different tubes

All jobs are added to the `default` tube by default. You can change the tube you want to produce a job in by using `use`.

```js
const tubeName = await beanstalkd.use('awesome-tube') // => 'awesome-tube'
await beanstalkd.put({ foo: 'bar' })
```

### Consumers

#### Reserving a job

Consumers work by reserving jobs in a tube. Reserving is a blocking operation and execution will stop until a job has been reserved.

```js
const { id, payload } = await beanstalkd.reserve() // wait until job incoming
console.log({ id, payload }) // => { id: '1', payload: '{"foo":"bar"}' }
```

`jackd` will return the payload as-is. This means you'll have to do `JSON.parse` yourself if you passed in an `Object`.

#### Performing job operations (delete/bury/touch/release)

Once you've reserved a job, there are several operations you can perform on it. The most common operation will be deleting the job after the consumer is finished processing it.

```js
await beanstalkd.delete(id)
```

Consumers can also give up their reservation by releasing the job. You'll usually want to release the job if an error occurred on the consumer and you want to put it back in the queue immediately.

```js
// Release immediately with high priority (0) and no delay (0)
await beanstalkd.release(id)

// You can also specify the priority and the delay
await beanstalkd.release(id,
  priority: 10
  delay: 1000
})
```

However, you may want to bury the job to be processed later under certain conditions, such as a recurring error or a job that can't be processed. Buried jobs will not be processed until they are kicked.

```js
await beanstalkd.bury(id)
// ... some time later ...
await beanstalkd.kickJob(id)
```

You'll notice that the kick operation is suffixed by `Job`. This is because there is a `kick` command in `beanstalkd` which will kick a certain number of jobs back into the tube.

```js
await beanstalkd.kick(10) // 10 buried jobs will be moved to a ready state
```

Consumers will sometimes need additional time to run jobs. You can `touch` those jobs to let `beanstalkd` know you're still processing them.

```js
await beanstalkd.touch(id)
```

#### Watching on multiple tubes

By default, all consumers will watch the `default` tube only. So naturally consumers can elect what tubes they want to watch.

```js
const numberOfTubesWatched = await beanstalkd.watch('my-special-tube')
// => 2
```

If a consumer is watching a tube and it no longer needs it, you can choose to ignore that tube as well.

```js
const numberOfTubesWatched = await beanstalkd.ignore('default')
// => 1
```

Please keep in mind that attempting to ignore the only tube being watched will return an error.

You can also bring back the current tubes watched using `list-tubes-watched`. However, there is no first-class support for this command because it returns YAML. This will be discussed in the next section.

### Executing arbitrary commands

`jackd` only has first-class support for commands that do not return YAML. This was an intentional design decision to allow the developer using `jackd` the flexibility to specify what YAML parser they want to use.

To execute commands that return YAML, `jackd` exposes the `executeMultiPartCommand` function:

```
const stats = await beanstalkd.executeMultiPartCommand('stats\r\n')
/* =>
---
current-jobs-urgent: 0
current-jobs-ready: 0
current-jobs-reserved: 0
current-jobs-delayed: 0
current-jobs-buried: 0
*/
```

You can then pipe this result through a YAML parser to get the actual contents of the YAML file.

```
const YAML = require('yaml')
const stats = await beanstalkd.executeMultiPartCommand('stats\r\n')
const { 'total-jobs': totalJobs } = YAML.parse(stats)
console.log(totalJobs)
// => 0
```

There is also an `executeCommand` method which will allow you to execute arbitary commands on `beanstalkd`. Please keep in mind that support for this use-case is limited.

## Upcoming

- [x] First-class methods for all non-YAML commands
- [ ] Worker pattern support
- [ ] Completed test suite
- [ ] API documentation
- [ ] Examples

## License

MIT
