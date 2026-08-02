interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: 'call';
  params: {
    service: string;
    method: string;
    args: any[];
  };
  id: number;
}

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_USERNAME = process.env.ODOO_USERNAME;
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;

/**
 * Generic helper to send a JSON-RPC request to Odoo.
 */
async function odooJsonRpc<T>(
  service: string,
  method: string,
  args: any[]
): Promise<T> {
  if (!ODOO_URL) {
    throw new Error('ODOO_URL environment variable is not defined');
  }

  // Ensure url ends correctly for jsonrpc
  const baseUrl = ODOO_URL.replace(/\/$/, '');
  const url = `${baseUrl}/jsonrpc`;

  const payload: JsonRpcRequest = {
    jsonrpc: '2.0',
    method: 'call',
    params: {
      service,
      method,
      args,
    },
    id: Math.floor(Math.random() * 1000000),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: JsonRpcResponse<T> = await response.json();

    if (data.error) {
      console.error('Odoo JSON-RPC error response:', data.error);
      throw new Error(data.error.message || 'Odoo JSON-RPC request failed');
    }

    if (data.result === undefined) {
      throw new Error('No result returned from Odoo JSON-RPC');
    }

    return data.result;
  } catch (error: any) {
    console.error('Odoo JSON-RPC connection error:', error);
    throw new Error(`Odoo API connection failed: ${error.message || error}`);
  }
}

let cachedUid: number | null = null;

/**
 * Authenticates with Odoo and returns the user UID.
 * Caches the UID in memory for subsequent requests.
 */
export async function getUid(): Promise<number> {
  if (cachedUid !== null) return cachedUid;

  if (!ODOO_DB || !ODOO_USERNAME || !ODOO_PASSWORD) {
    throw new Error(
      'Missing Odoo configuration environment variables (ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD)'
    );
  }

  const uid = await odooJsonRpc<number | false>('common', 'authenticate', [
    ODOO_DB,
    ODOO_USERNAME,
    ODOO_PASSWORD,
    {},
  ]);

  if (uid === false || !uid) {
    throw new Error('Odoo authentication failed. Please check your credentials.');
  }

  cachedUid = uid;
  return uid;
}

/**
 * Executes a method on an Odoo model via execute_kw.
 * Automatically authenticates if necessary.
 */
export async function executeKw<T>(
  model: string,
  method: string,
  args: any[],
  kwargs: Record<string, any> = {}
): Promise<T> {
  const uid = await getUid();

  if (!ODOO_DB || !ODOO_PASSWORD) {
    throw new Error(
      'Missing Odoo configuration environment variables (ODOO_DB, ODOO_PASSWORD)'
    );
  }

  return odooJsonRpc<T>('object', 'execute_kw', [
    ODOO_DB,
    uid,
    ODOO_PASSWORD,
    model,
    method,
    args,
    kwargs,
  ]);
}

/**
 * Alias to executeKw for standard JSON-RPC operations.
 */
export const odooCall = executeKw;

