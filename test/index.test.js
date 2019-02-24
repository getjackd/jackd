const { expect } = require('chai')
const { JackdClient } = require('../src')

describe('jackd', function() {
  it('can connect to and disconnect from beanstalkd', async function() {
    const c = new JackdClient()
    await c.connect()
    await c.close()
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

  describe('jobs', function() {
    setupTestSuiteLifecycleWithClient()

    it('can insert jobs', async function() {
      const id = await this.client.put('some random job')
      expect(id).to.be.ok
      await this.client.delete(id)
    })

    it('can receive jobs', async function() {
      const id = await this.client.put('some random job')
      const job = await this.client.reserve()

      expect(job.id).to.equal(id)
      expect(job.payload).to.equal('some random job')

      await this.client.delete(id)
    })
  })
})

function setupTestSuiteLifecycleWithClient() {
  beforeEach(function() {
    this.client = new JackdClient()
    this.client.connect()
  })

  afterEach(function() {
    this.client.close()
  })
}
