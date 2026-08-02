'use server'

import { executeKw } from '@/lib/odoo'

export async function submitContact(formData: FormData) {
  const name = formData.get('name') as string
  const email = formData.get('email') as string
  const phone = formData.get('phone') as string
  const company = formData.get('company') as string
  const message = formData.get('message') as string

  if (!name?.trim()) {
    return { success: false, error: 'Name is required' }
  }
  if (!email?.trim()) {
    return { success: false, error: 'Email is required' }
  }
  if (!phone?.trim()) {
    return { success: false, error: 'Phone is required' }
  }
  if (!company?.trim()) {
    return { success: false, error: 'Company is required' }
  }
  if (!message?.trim()) {
    return { success: false, error: 'Message is required' }
  }

  try {
    const customerEmail = email.trim().toLowerCase()
    const customerPhone = phone.trim()
    const customerName = name.trim()
    const customerCompany = company.trim()

    const existingPartnerIds = await executeKw<number[]>('res.partner', 'search', [
      ['|', ['email', '=', customerEmail], ['phone', '=', customerPhone]],
    ])
    const existingPartnerId = existingPartnerIds[0]
    const isNewCustomer = !existingPartnerId

    let partnerId: number

    if (isNewCustomer) {
      let parentId: number | false = false
      if (customerCompany) {
        const companyIds = await executeKw<number[]>('res.partner', 'search', [
          [['name', '=', customerCompany], ['is_company', '=', true]],
        ])
        parentId = companyIds[0] as number | undefined || false
        if (!parentId) {
          parentId = await executeKw<number>('res.partner', 'create', [{
            name: customerCompany,
            is_company: true,
          }])
        }
      }

      partnerId = await executeKw<number>('res.partner', 'create', [{
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
        is_company: false,
        ...(parentId ? { parent_id: parentId } : {}),
      }])
    } else {
      partnerId = existingPartnerId
    }

    const tagName = isNewCustomer ? 'عميل جديد' : 'مسجل بالفعل على السيستم'
    const existingTags = await executeKw<number[]>('helpdesk.tag', 'search', [[['name', '=', tagName]]])
    let tagId = existingTags[0]

    if (!tagId) {
      tagId = await executeKw<number>('helpdesk.tag', 'create', [{ name: tagName }])
    }

    const ticketId = await executeKw<number>('helpdesk.ticket', 'create', [{
      name: `[Contact Form] ${customerName}${isNewCustomer ? ' (عميل جديد)' : ''}`,
      description: message.trim(),
      partner_id: partnerId,
      team_id: 1,
      tag_ids: [tagId],
    }])

    const chatterBody = [
      `📩 رسالة جديدة من نموذج الاتصال:`,
      ``,
      `👤 الاسم: ${customerName}`,
      `🏢 الشركة: ${customerCompany}`,
      `📧 البريد الإلكتروني: ${customerEmail}`,
      `📱 رقم الجوال: ${customerPhone}`,
      ``,
      `— — — — — — — — — — — — — —`,
      ``,
      `${message.trim()}`,
    ].join('\n')

    await executeKw<number>(
      'helpdesk.ticket',
      'message_post',
      [ticketId],
      {
        body: chatterBody,
        message_type: 'comment',
        subtype_xmlid: 'mail.mt_note',
      },
    )

    return { success: true }
  } catch {
    return { success: false, error: 'failed' }
  }
}
