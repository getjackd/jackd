const { expect } = require('chai')
const Jackd = require('../src')
const YAML = require('yaml')

describe('jackd', function() {
  it('can connect to and disconnect from beanstalkd', async function() {
    const c = new Jackd()
    await c.connect()
    await c.close()
  })

  describe('connectivity', function() {
    setupTestSuiteLifecycleWithClient()

    it('connected', function() {
      expect(this.client.connected).to.be.ok
    })

    it('disconnected', async function() {
      await this.client.disconnect()
      expect(this.client.ocnnected).to.not.be.ok
    })
  })

  describe('handles errors', function() {
    setupTestSuiteLifecycleWithClient()

    it('handles bad format', async function() {
      try {
        await this.client.executeCommand('put 0 0\r\n')
      } catch (err) {
        expect(err.message).to.equal('BAD_FORMAT')
        return
      }
      throw new Error('no-error-caught')
    })

    it('handles unknown command', async function() {
      try {
        await this.client.executeCommand('random\r\n')
      } catch (err) {
        expect(err.message).to.equal('UNKNOWN_COMMAND')
        return
      }
      throw new Error('no-error-caught')
    })
  })

  describe('producers', function() {
    setupTestSuiteLifecycleWithClient()

    it('can insert jobs', async function() {
      const id = await this.client.put('some random job')
      expect(id).to.be.ok
      await this.client.delete(id)
    })

    it('can insert jobs with objects', async function() {
      const id = await this.client.put({ foo: 'bar' })
      expect(id).to.be.ok

      const job = await this.client.reserve()
      expect(job.payload).to.equal('{"foo":"bar"}')

      await this.client.delete(id)
    })

    it('can insert jobs with priority', async function() {
      const id = await this.client.put({ foo: 'bar' }, { priority: 12342342 })
      expect(id).to.be.ok

      const job = await this.client.reserve()
      await this.client.delete(id)

      expect(job.payload).to.equal('{"foo":"bar"}')
    })
  })

  describe('consumers', function() {
    setupTestSuiteLifecycleWithClient()

    it('can receive jobs', async function() {
      const id = await this.client.put('some random job')
      const job = await this.client.reserve()

      expect(job.id).to.equal(id)
      expect(job.payload).to.equal('some random job')

      await this.client.delete(id)
    })

    it('can receive delayed jobs', async function() {
      const id = await this.client.put('some random job', {
        delay: 1
      })

      const job = await this.client.reserve()

      expect(job.id).to.equal(id)
      expect(job.payload).to.equal('some random job')

      await this.client.delete(id)
    })

    it('can insert and process jobs on a different tube', async function() {
      await this.client.use('some-other-tube')
      const id = await this.client.put('some random job on another tube')

      await this.client.watch('some-other-tube')
      const job = await this.client.reserve()

      expect(job.id).to.equal(id)
      expect(job.payload).to.equal('some random job on another tube')

      await this.client.delete(id)
    })

    it('will ignore jobs from default', async function() {
      const defaultId = await this.client.put('job on default')
      await this.client.use('some-other-tube')
      const id = await this.client.put('some random job on another tube')

      await this.client.watch('some-other-tube')
      await this.client.ignore('default')

      const job = await this.client.reserve()

      expect(job.id).to.equal(id)
      expect(job.payload).to.equal('some random job on another tube')

      await this.client.delete(id)
      await this.client.delete(defaultId)
    })

    it('handles multiple promises fired at once', async function() {
      this.client.use('some-tube')
      const firstJobPromise = this.client.put('some-job')
      this.client.watch('some-random-tube')
      this.client.use('some-another-tube')
      const secondJobPromise = this.client.put('some-job')

      const id1 = await firstJobPromise
      const id2 = await secondJobPromise

      await this.client.delete(id1)
      await this.client.delete(id2)
    })

    it('can receive huge jobs', async function() {
      // job larger than a socket data frame
      const hugeText = new Array(50000).join('a')
      const id = await this.client.put(hugeText)
      const job = await this.client.reserve()

      expect(job.id).to.equal(id)
      expect(job.payload).to.equal(hugeText)

      await this.client.delete(id)
    })

    it('can peek buried jobs', async function() {
      await this.client.use('some-tube')

      const id = await this.client.put('some-job')

      await this.client.watch('some-tube')
      await this.client.reserve()
      await this.client.bury(id)

      const job = await this.client.peekBuried()

      expect(job.id).to.equal(id)
      await this.client.delete(id)
    })
  })

  describe('multi-part commands', function() {
    setupTestSuiteLifecycleWithClient()

    it('brings back stats', async function() {
      const stats = await this.client.executeMultiPartCommand('stats\r\n')
      YAML.parse(stats)
    })
  })
})

function setupTestSuiteLifecycleWithClient() {
  beforeEach(async function() {
    this.client = new Jackd()
    await this.client.connect()
  })

  afterEach(async function() {
    await this.client.close()
  })
}
