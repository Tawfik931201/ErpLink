import { isTransientXmlRpcTransportError } from '../../src/lib/odoo-client'

describe('Odoo XML-RPC transport error classification', () => {
  it('classifies HTML proxy parser failures as transient', () => {
    expect(isTransientXmlRpcTransportError(new Error("Unknown XML-RPC tag 'TITLE'"))).toBe(true)
    expect(isTransientXmlRpcTransportError(new Error('502 Bad Gateway'))).toBe(true)
    expect(isTransientXmlRpcTransportError(new Error('socket hang up'))).toBe(true)
  })

  it('does not classify Odoo business faults as transient transport errors', () => {
    expect(isTransientXmlRpcTransportError(new Error('ValidationError: duplicate product combination'))).toBe(false)
    expect(isTransientXmlRpcTransportError(new Error('AccessError: operation not permitted'))).toBe(false)
  })
})
