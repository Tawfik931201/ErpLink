# Odoo Studio server action 243, automation 5 (on_message_sent).
# Update the agent clock from an actual public Chatter reply.
if record and record.x_channel == 'app' and record.x_ticket_stage not in ('closed', 'resolved'):
    msg = env['mail.message'].sudo().search([
        ('model', '=', 'x_erplink_support_ticket'),
        ('res_id', '=', record.id),
        ('message_type', '=', 'comment'),
        ('is_internal', '=', False),
    ], order='id desc', limit=1)
    internal_partners = env['res.users'].sudo().search([
        ('share', '=', False), ('active', '=', True),
    ]).mapped('partner_id').ids
    if msg and msg.author_id.id in internal_partners:
        if not record.x_last_agent_reply or msg.date > record.x_last_agent_reply:
            record.sudo().write({'x_last_agent_reply': msg.date})
