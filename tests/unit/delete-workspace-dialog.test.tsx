/**
 * @jest-environment jsdom
 *
 * Delete-workspace safety gate (season plan add-on).
 *
 * Workspace deletion is permanent and wipes ~30 tables (see
 * src/lib/workspace-purge.ts), so the dialog must force the owner to:
 *   1. type the workspace name MANUALLY — copy/cut/paste/drag-drop blocked,
 *   2. acknowledge EVERY data category with its own checkbox.
 * And deletion itself must stay owner-only (members never delete).
 */

import fs from 'fs'
import path from 'path'

import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

import { LanguageProvider } from '@/components/language-provider'
import { DeleteWorkspaceDialog } from '@/components/workspace/DeleteWorkspaceDialog'

const SRC = path.join(__dirname, '..', '..', 'src')

function readSrc(...parts: string[]): string {
  return fs.readFileSync(path.join(SRC, ...parts), 'utf8').replace(/\r/g, '')
}

function renderDialog(name = 'متجري الأول', onConfirm = async () => {}) {
  return render(
    <LanguageProvider initialLang="ar">
      <DeleteWorkspaceDialog
        open={true}
        onOpenChange={() => {}}
        workspaceName={name}
        onConfirm={onConfirm}
      />
    </LanguageProvider>
  )
}

function deleteButton(): HTMLElement {
  return screen.getByRole('button', { name: /حذف نهائي/i })
}

describe('DeleteWorkspaceDialog safety gate', () => {
  it('starts with deletion disabled', () => {
    renderDialog()
    expect(deleteButton()).toBeDisabled()
  })

  it('blocks paste: value stays empty and a warning appears', () => {
    renderDialog()
    const input = screen.getByLabelText('تأكيد اسم بيئة العمل')
    fireEvent.paste(input, { clipboardData: { getData: () => 'متجري الأول' } })
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.getByText(/النسخ واللصق والسحب معطّلة/i)).toBeInTheDocument()
    expect(deleteButton()).toBeDisabled()
  })

  it('blocks drop and cut the same way', () => {
    renderDialog()
    const input = screen.getByLabelText('تأكيد اسم بيئة العمل')
    fireEvent.drop(input)
    fireEvent.cut(input)
    expect((input as HTMLInputElement).value).toBe('')
    expect(deleteButton()).toBeDisabled()
  })

  it('a wrong name keeps deletion disabled', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('تأكيد اسم بيئة العمل'), {
      target: { value: 'اسم خاطئ' },
    })
    expect(deleteButton()).toBeDisabled()
  })

  it('correct name alone is not enough — every checkbox is required', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('تأكيد اسم بيئة العمل'), {
      target: { value: 'متجري الأول' },
    })
    expect(deleteButton()).toBeDisabled()

    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.length).toBeGreaterThanOrEqual(5)
    boxes.forEach((b) => fireEvent.click(b))
    expect(deleteButton()).toBeEnabled()

    fireEvent.click(boxes[0])
    expect(deleteButton()).toBeDisabled()
  })

  it('confirms only when name matches AND all boxes checked', async () => {
    let confirmed = 0
    renderDialog('متجري الأول', async () => {
      confirmed += 1
    })
    fireEvent.change(screen.getByLabelText('تأكيد اسم بيئة العمل'), {
      target: { value: 'متجري الأول' },
    })
    screen.getAllByRole('checkbox').forEach((b) => fireEvent.click(b))
    fireEvent.click(deleteButton())
    await waitFor(() => expect(confirmed).toBe(1))
  })
})

describe('owner-only deletion (source pins)', () => {
  it('server rejects non-owners', () => {
    const actions = readSrc('app', 'actions', 'workspaces.ts')
    expect(actions).toContain('workspace.user_id !== user.id')
  })

  it('UI hides delete/edit controls from non-owners', () => {
    const page = readSrc('app', '(app)', 'app', 'settings', 'workspace', 'page.tsx')
    expect(page).toContain('ws.user_id === currentUserId')
  })
})
