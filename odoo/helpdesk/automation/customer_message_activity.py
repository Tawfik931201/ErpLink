# Odoo Studio server action 242, automation 4 (on_message_received)
# Creates an Odoo Activities systray entry per customer reply. No emails.
if record and record.x_channel == 'app' and record.x_ticket_stage not in ('closed', 'resolved') and record.x_partner_id:
    msg = env['mail.message'].sudo().search([
        ('model', '=', 'x_erplink_support_ticket'),
        ('res_id', '=', record.id),
        ('message_type', '=', 'comment'),
        ('is_internal', '=', False),
    ], order='id desc', limit=1)
    if msg and msg.author_id.id == record.x_partner_id.id:
        agent = record.x_assigned_user_id or env['res.users'].sudo().browse(2)
        if agent.exists() and agent.active and not agent.share:
            summary = 'ERP Link: Customer reply #%s on SUP-%s' % (msg.id, record.id)
            existing = env['mail.activity'].sudo().search([
                ('res_model_id', '=', 2433),
                ('res_id', '=', record.id),
                ('summary', '=', summary),
            ], limit=1)
            if not existing:
                env['mail.activity'].sudo().create({
                    'res_model_id': 2433,
                    'res_id': record.id,
                    'activity_type_id': 4,
                    'user_id': agent.id,
                    'summary': summary,
                    'note': '<p>New ERP Link customer message. Open this support ticket to read and respond.</p>',
                    'date_deadline': datetime.date.today().isoformat(),
                    'automated': True,
                })
        vals = {'x_last_customer_reply': msg.date}
        if record.x_ticket_stage == 'waiting_customer':
            vals['x_ticket_stage'] = 'open'
            vals['x_status'] = 'open'
        record.sudo().write(vals)
