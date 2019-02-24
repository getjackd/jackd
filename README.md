# jackd

[![Build Status](https://img.shields.io/circleci/project/github/divmgl/jackd/master.svg)](https://circleci.com/gh/divmgl/jackd/tree/master)

**This project is currently WIP. Do not use until version 1**.

```js
/* producer.js */
const beanstalkd = require('jackd')

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

## Upcoming

- [x] First-class methods for all commands without YAML
- [ ] Completed test suite
- [ ] API documentation
- [ ] Examples

## License

MIT
