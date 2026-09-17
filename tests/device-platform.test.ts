import assert from 'node:assert/strict'
import test from 'node:test'
import { devicePlatform } from '../lib/auth/device-platform.ts'

test('device labels distinguish mobile platforms and browser variants', () => {
    assert.deepEqual(devicePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605 Safari/604'), { platform: 'iPhone', browser: 'Safari', mobile: true })
    assert.deepEqual(devicePlatform('Mozilla/5.0 (Linux; Android 15) Chrome/133 Mobile Safari/537'), { platform: 'Android', browser: 'Chrome', mobile: true })
    assert.deepEqual(devicePlatform('Mozilla/5.0 (Windows NT 10.0) Chrome/133 Safari/537 Edg/133'), { platform: 'Windows', browser: 'Edge', mobile: false })
    assert.equal(devicePlatform('Mozilla/5.0 (iPad) CriOS/131 Safari/604').browser, 'Chrome')
    assert.equal(devicePlatform('Mozilla/5.0 (iPhone) FxiOS/132 Safari/604').browser, 'Firefox')
    assert.deepEqual(devicePlatform(null), { platform: 'Unknown platform', browser: 'Browser', mobile: false })
})
