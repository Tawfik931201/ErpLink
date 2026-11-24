# Odoo Studio server action 244, Odoo cron 23 (hourly).
# Auto-close only after 120 full hours since the last REAL public agent reply
# and if NO customer response has arrived since that reply.
# No dependency on Hostinger, Supabase, or the ERP Link application scheduler.
cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=5)
tickets = env['x_erplink_support_ticket'].sudo().search([
    ('x_channel', '=', 'app'),
    ('x_ticket_stage', 'in', ['open', 'in_progress', 'waiting_customer']),
    ('x_last_agent_reply', '!=', False),
    ('x_last_agent_reply', '<=', cutoff),
], limit=500)
if tickets:
    staff_partner_ids = env['res.users'].sudo().search([
        ('share', '=', False),
    ]).mapped('partner_id').ids
    for ticket in tickets:
        agent_date = ticket.x_last_agent_reply
        customer_date = ticket.x_last_customer_reply
        if customer_date and customer_date >= agent_date:
            continue
        latest = env['mail.message'].sudo().search([
            ('model', '=', 'x_erplink_support_ticket'),
            ('res_id', '=', ticket.id),
            ('message_type', '=', 'comment'),
            ('is_internal', '=', False),
        ], order='date desc,id desc', limit=1)
        if not latest:
            continue
        if latest.author_id.id not in staff_partner_ids:
            continue
        if not latest.date or latest.date > cutoff:
            continue
        ticket.sudo().write({
            'x_ticket_stage': 'closed',
            'x_status': 'closed',
        })
