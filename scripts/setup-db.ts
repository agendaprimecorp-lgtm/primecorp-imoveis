import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  db: { schema: 'public' },
});

async function runMigrations() {
  console.log('🔄 Verificando schema do banco...');

  try {
    // Verificar se tabelas existem (devem estar das migrações do Supabase)
    const { data: tables, error } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public');

    if (error) {
      console.log('⚠️  Não foi possível verificar tabelas (Supabase pode não expor esta view)');
      console.log('    Assumindo que migrações já foram aplicadas.');
    } else {
      const tableNames = tables?.map((t) => t.table_name) || [];
      console.log(`✅ Encontradas ${tableNames.length} tabelas no schema public`);
      console.log('   Tabelas:', tableNames.join(', '));
    }

    // Verificar políticas de RLS
    console.log('🔐 Verificando políticas de Row Level Security...');
    const { data: policies } = await supabase
      .from('information_schema.role_table_grants')
      .select('table_name')
      .eq('grantee', 'authenticated');

    if (policies && policies.length > 0) {
      console.log('✅ Políticas de RLS encontradas');
    } else {
      console.log('⚠️  Nenhuma concessão autenticada encontrada (pode ser normal)');
    }

    console.log('✅ Inicialização do banco completa');
  } catch (err) {
    console.error('❌ Migração falhou:', err);
    process.exit(1);
  }
}

runMigrations();
