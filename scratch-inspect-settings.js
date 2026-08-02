const { createClient } = require('./node_modules/@supabase/supabase-js')
const fs = require('fs')

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const envText = fs.readFileSync(filePath, 'utf8')
  const env = {}
  envText.split('\n').forEach(line => {
    const parts = line.split('=')
    if (parts.length >= 2) {
      const k = parts[0].trim()
      const v = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '')
      env[k] = v
    }
  })
  return env
}

const env = { ...parseEnv('.env'), ...parseEnv('.env.local') }
const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const wsId = '842546d3-1df0-4d4d-a327-95415f5dd4c1'
  console.log('--- STANDARD MAPPING SETTINGS ---')
  const { data: stdSettings, error: e1 } = await supabaseAdmin
    .from('standard_mapping_settings')
    .select('*')
    .eq('workspace_id', wsId)
  console.log(JSON.stringify(stdSettings, null, 2), e1)
}
main()
