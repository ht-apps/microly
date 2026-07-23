import Taro from '@tarojs/taro'

function randomByte() {
  return Math.floor(Math.random() * 256)
}

function formatUuid(bytes: Uint8Array) {
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createUuid() {
  const bytes = new Uint8Array(16)
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = randomByte()
    const time = Date.now()
    for (let index = 0; index < 6; index += 1) {
      bytes[index] ^= (time / (2 ** (index * 8))) & 0xff
    }
  }
  return formatUuid(bytes)
}

export async function createSecureUuid() {
  if (process.env.TARO_ENV === 'h5') return createUuid()
  try {
    const result = await Taro.getRandomValues({ length: 16 })
    return formatUuid(new Uint8Array(result.randomValues))
  } catch {
    return createUuid()
  }
}
