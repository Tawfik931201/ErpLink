/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

import EmbeddedStorageGate from '../../src/components/embedded-storage-gate'

const realSelf = window.self
function renderGate() {
  return render(React.createElement(EmbeddedStorageGate, null, React.createElement('p', null, 'sign-in form')))
}
beforeEach(() => {
  Object.defineProperty(window, 'self', { value: {}, configurable: true })
  document.hasStorageAccess = jest.fn().mockResolvedValue(false)
  document.requestStorageAccess = jest.fn().mockRejectedValue(new Error('denied'))
})
afterEach(() => { Object.defineProperty(window, 'self', { value: realSelf, configurable: true }) })

it('keeps normal first-party login available', async () => {
  Object.defineProperty(window, 'self', { value: realSelf, configurable: true })
  renderGate()
  expect(await screen.findByText('sign-in form')).toBeInTheDocument()
  expect(document.hasStorageAccess).not.toHaveBeenCalled()
})
it('allows login in an iframe with existing storage access', async () => {
  document.hasStorageAccess = jest.fn().mockResolvedValue(true)
  renderGate()
  expect(await screen.findByText('sign-in form')).toBeInTheDocument()
})
it('does not start OTP on a blocked embedded session', async () => {
  renderGate()
  expect(await screen.findByRole('button')).toBeEnabled()
  expect(screen.queryByText('sign-in form')).not.toBeInTheDocument()
  expect(document.requestStorageAccess).not.toHaveBeenCalled()
})
it('requests storage directly on click and explains a browser refusal', async () => {
  renderGate()
  fireEvent.click(await screen.findByRole('button'))
  expect(document.requestStorageAccess).toHaveBeenCalledTimes(1)
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button')).toBeEnabled())
})
it('handles a failed storage check without a stuck loading screen', async () => {
  document.hasStorageAccess = jest.fn().mockRejectedValue(new Error('unavailable'))
  renderGate()
  expect(await screen.findByRole('button')).toBeEnabled()
})
