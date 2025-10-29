import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Initialize Supabase client with service role key (server-side)
    const adminClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { action, params } = req.body;

    let result;

    switch (action) {
      // SELECT operations
      case 'select':
        result = await handleSelect(adminClient, params);
        break;

      // INSERT operations
      case 'insert':
        result = await handleInsert(adminClient, params);
        break;

      // UPDATE operations
      case 'update':
        result = await handleUpdate(adminClient, params);
        break;

      // UPSERT operations
      case 'upsert':
        result = await handleUpsert(adminClient, params);
        break;

      // RPC (stored procedures)
      case 'rpc':
        result = await handleRpc(adminClient, params);
        break;

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Admin proxy error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// SELECT handler
async function handleSelect(client, params) {
  const { table, columns = '*', filters = {}, single = false, order } = params;
  
  let query = client.from(table).select(columns);

  // Apply filters
  Object.entries(filters).forEach(([key, value]) => {
    query = query.eq(key, value);
  });

  // Apply ordering
  if (order) {
    query = query.order(order.column, { ascending: order.ascending !== false });
  }

  // Single vs multiple
  if (single) {
    return await query.maybeSingle();
  }

  return await query;
}

// INSERT handler
async function handleInsert(client, params) {
  const { table, data, select = false } = params;
  
  let query = client.from(table).insert(data);
  
  if (select) {
    query = query.select();
  }

  return await query;
}

// UPDATE handler
async function handleUpdate(client, params) {
  const { table, data, filters = {} } = params;
  
  let query = client.from(table).update(data);

  // Apply filters
  Object.entries(filters).forEach(([key, value]) => {
    query = query.eq(key, value);
  });

  return await query;
}

// UPSERT handler
async function handleUpsert(client, params) {
  const { table, data, onConflict } = params;
  
  const options = onConflict ? { onConflict } : {};
  
  return await client.from(table).upsert(data, options);
}

// RPC handler
async function handleRpc(client, params) {
  const { functionName, args = {} } = params;
  
  return await client.rpc(functionName, args);
}