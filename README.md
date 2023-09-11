# jackd

![Tests](https://github.com/getjackd/jackd/actions/workflows/test.yml/badge.svg)

```js
// Connecting
const Jackd = require('jackd')
const beanstalkd = new Jackd()
await beanstalkd.connect()

// Producing
await beanstalkd.put('Hello!')

// Consuming
const job = await beanstalkd.reserve() // => { id: '1', payload: 'Hello!' }

// ...process the job... then:
await beanstalkd.delete(job.id)
```

## Installation

```
$ npm i jackd
```

### Version 2.x fixes a critical bug

> :warning: If you're using `jackd` in production, you should upgrade `jackd` to version 2.x. [Read more here.](https://github.com/getjackd/jackd/releases/tag/v2.0.1)

## Why

Most `beanstalkd` clients don't support promises (fivebeans, nodestalker) and the ones that do have too many dependencies (node-beanstalkd-client). We wanted to make a package that has:

- A concise and easy to use API
- Native promise support
- No dependencies
- Protocol accuracy/completeness

## Overview

`beanstalkd` is a simple and blazing fast work queue. Producers connected through TCP sockets (by default on port `11300`) send in jobs to be processed at a later time by a consumer.

If you don't have experience using `beanstalkd`, [it's a good idea to read the `beanstalkd` protocol before using this library.](https://github.com/beanstalkd/beanstalkd/blob/master/doc/protocol.txt)

### Connecting and disconnecting

```js
const Jackd = require('jackd')
const beanstalkd = new Jackd()

await beanstalkd.connect() // Connects to localhost:11300
await beanstalkd.connect({ host, port })

await beanstalkd.disconnect() // You can also use beanstalkd.quit; it's an alias
```

### Producers

#### Adding jobs into a tube

You can add jobs to a tube by using the `put` command, which accepts a payload and returns a job ID.

`beanstalkd` job payloads are byte arrays. Passing in a `Buffer` will send the payload as-is.

```js
// This is a byte array of a UTF-8 encoded string
const jobId = await beanstalkd.put(Buffer.from('my long running job'))
```

You can also pass in a `String` or an `Object` and `jackd` will automatically convert these values into byte arrays.

```js
const jobId = await beanstalkd.put('my long running job') // Buffer.from(string)
const jobId = await beanstalkd.put({ foo: 'bar' }) // Buffer.from(JSON.stringify(object))
```

All jobs sent to beanstalkd have a priority, a delay, and TTR (time-to-run) specification. By default, all jobs are published with `0` priority, `0` delay, and `60` TTR, which means consumers will have 60 seconds to finish the job after reservation. You can override these defaults:

```js
await beanstalkd.put(
  { foo: 'bar' },
  {
    delay: 2, // Two second delay
    priority: 10,
    ttr: 600 // Ten minute delay
  }
)
```

Jobs with lower priorities are handled first. Refer to [the protocol specs](https://github.com/beanstalkd/beanstalkd/blob/master/doc/protocol.txt#L126) for more information on job options.

#### Using different tubes

All jobs by default are added to the `default` tube. You can change where you produce jobs with the `use` command.

```js
const tubeName = await beanstalkd.use('awesome-tube') // => 'awesome-tube'
await beanstalkd.put({ foo: 'bar' })
```

### Consumers

#### Reserving a job

Consumers reserve jobs from tubes. Using `await` on a `reserve` command is a blocking operation and execution will stop until a job has been reserved.

```js
const { id, payload } = await beanstalkd.reserve() // wait until job incoming
console.log({ id, payload }) // => { id: '1', payload: Buffer }
```

`jackd` will return the payload as-is. This means you'll have to handle the encoding yourself. For instance, if you sent in an `Object`, you'll need to first convert the `Buffer` to a `String` and then parse the JSON.

```js
const { id, payload } = await beanstalkd.reserve()
const object = JSON.parse(payload.toString())
```

If you passed in a `String`, you'll need to convert the incoming `Buffer` to a string.

```js
const { id, payload } = await beanstalkd.reserve()
const message = payload.toString()
```

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
  delay: 10
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

By default, all consumers will watch the `default` tube only. Consumers can elect what tubes they want to watch.

```js
const numberOfTubesWatched = await beanstalkd.watch('my-special-tube')
// => 2
```

Consumers can also ignore tubes.

```js
const numberOfTubesWatched = await beanstalkd.ignore('default')
// => 1
```

Be aware that attempting to ignore the only tube being watched will return an error.

### Executing YAML commands

`beanstalkd` has a number of commands that return YAML payloads. These commands mostly return statistics regarding the current `beanstalkd` instance. `jackd`, on purpose, does not ship with a YAML parser. This is to:

- Avoid dependencies
- Stay close to the protocol spec
- Let callers decide how to parse YAML

`jackd` has full support for all commands, so you can expect to find these YAML commands in the API.

```js
const stats = await beanstalkd.stats()
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

```js
const YAML = require('yaml')
const stats = await beanstalkd.executeMultiPartCommand('stats\r\n')
const { 'total-jobs': totalJobs } = YAML.parse(stats)
console.log(totalJobs)
// => 0
```

## Worker pattern

You may be looking to design a process that does nothing else but consume jobs. You can accomplish this with one `jackd` client using `async/await`. Here's an example implementation.

```js
/* consumer.js */
const Jackd = require('jackd')
const beanstalkd = new Jackd()

start()

async function start() {
  // Might want to do some error handling around connections
  await beanstalkd.connect()

  while (true) {
    try {
      const { id, payload } = await beanstalkd.reserve()
      /* ... process job here ... */
      await beanstalkd.delete(id)
    } catch (err) {
      // Log error somehow
      console.error(err)
    }
  }
}
```

# License

MIT
