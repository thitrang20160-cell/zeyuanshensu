import { User, Appeal, Transaction, UserRole, SystemConfig, KnowledgeBaseItem, PoaType } from '../types';
import { createClient } from '@supabase/supabase-js';

// ==========================================
// 🔐 安全更新：密钥现已移至环境变量
// ==========================================
// Netlify 环境变量配置：
// VITE_SUPABASE_URL
// VITE_SUPABASE_ANON_KEY
const SUPABASE_URL = (import.meta as any).env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('Supabase 环境变量未配置，数据库连接将失败。');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Auth & Profiles ---

// 注册：创建 Auth 用户，并在 users 表创建档案
export const signUp = async (email: string, pass: string): Promise<{ user: User | null, error: string | null }> => {
  // 1. Create Auth User (This creates the login credentials in Supabase Auth System)
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password: pass,
  });

  if (authError) return { user: null, error: authError.message };
  if (!authData.user) return { user: null, error: '注册失败，未返回用户信息' };

  // 2. Create Profile in 'users' public table (This stores balance, role, etc.)
  const newUser: User = {
    id: authData.user.id, // CRITICAL: This ID links the public profile to the Auth User
    username: email.split('@')[0], // Use part of email as display name
    role: UserRole.CLIENT, // Default role
    balance: 0,
    createdAt: new Date().toISOString(),
  };

  const { error: dbError } = await supabase.from('users').insert(newUser);
  
  if (dbError) {
    // If profile creation fails, we might want to clean up the auth user, but for now just report error
    console.error('Error creating user profile:', dbError);
    return { user: null, error: '账号创建成功但档案生成失败，请联系管理员' };
  }

  return { user: newUser, error: null };
};

// 登录：Auth 登录，然后获取 users 表档案
export const signIn = async (email: string, pass: string): Promise<{ user: User | null, error: string | null }> => {
  // 1. Auth Login (Validates against Supabase Auth System)
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password: pass,
  });

  if (authError) return { user: null, error: '邮箱或密码错误' };
  if (!authData.user) return { user: null, error: '登录失败' };

  // 2. Fetch Profile from public.users table
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('*')
    .eq('id', authData.user.id)
    .single();

  if (profileError || !profile) {
    // If the user exists in Auth but not in public.users (e.g. manually created in Supabase Dashboard),
    // we should create a default profile for them so they can use the app.
    if (profileError.code === 'PGRST116') { // No rows returned
       const defaultProfile: User = {
          id: authData.user.id,
          username: email.split('@')[0],
          role: UserRole.CLIENT,
          balance: 0,
          createdAt: new Date().toISOString()
       };
       await supabase.from('users').insert(defaultProfile);
       return { user: defaultProfile, error: null };
    }
    return { user: null, error: '无法获取用户档案' };
  }

  return { user: profile as User, error: null };
};

export const signOut = async () => {
  await supabase.auth.signOut();
};

export const getCurrentUserProfile = async (): Promise<User | null> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data } = await supabase.from('users').select('*').eq('id', session.user.id).single();
  return data as User | null;
};


// --- Storage (Buckets) ---
export const uploadAppealEvidence = async (file: File): Promise<string | null> => {
  try {
    const fileExt = file.name.split('.').pop();
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.]/g, '_'); // Sanitize
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}-${cleanFileName}`;
    const filePath = `${fileName}`;

    // Upload to 'evidence' bucket
    const { error: uploadError } = await supabase.storage
      .from('evidence')
      .upload(filePath, file);

    if (uploadError) {
      console.error('Error uploading file:', uploadError);
      return null;
    }

    // Get public URL
    const { data } = supabase.storage.from('evidence').getPublicUrl(filePath);
    return data.publicUrl;
  } catch (err) {
    console.error('Unexpected error uploading file:', err);
    return null;
  }
};

// --- QR Code Storage ---
export const uploadPaymentQr = async (file: File): Promise<{url: string | null, error?: string}> => {
  try {
    // Sanitize filename to prevent issues
    const fileExt = file.name.split('.').pop() || 'png';
    const fileName = `qr_${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('evidence') 
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: true // Try upsert true for robustness
      });

    if (uploadError) {
      console.error('Supabase upload error:', uploadError);
      return { url: null, error: uploadError.message };
    }

    const { data } = supabase.storage.from('evidence').getPublicUrl(fileName);
    return { url: data.publicUrl };
  } catch (err: any) {
    console.error('JS Error during upload:', err);
    return { url: null, error: err.message || 'Unknown error' };
  }
};

// --- System Configuration (Contact Info & QR URL) ---
export const saveSystemConfig = async (config: SystemConfig): Promise<{success: boolean, error?: string}> => {
  try {
    const fileName = 'system_config.json';
    const blob = new Blob([JSON.stringify(config)], { type: 'application/json' });

    // Force strict cache control on upload
    const { error } = await supabase.storage
      .from('evidence')
      .upload(fileName, blob, { 
        upsert: true, 
        contentType: 'application/json', 
        cacheControl: '0' 
      });
      
    if (error) {
      console.warn('Config upsert failed:', error.message);
      
      // Fallback: Delete then Upload (sometimes helps with sticky RLS policies)
      const { error: delError } = await supabase.storage.from('evidence').remove([fileName]);
      if (delError && delError.message !== 'The resource was not found') {
         console.warn('Delete failed:', delError.message);
      }
      
      const { error: retryError } = await supabase.storage
        .from('evidence')
        .upload(fileName, blob, { 
           upsert: true, 
           contentType: 'application/json', 
           cacheControl: '0' 
        });

      if (retryError) {
        return { success: false, error: retryError.message };
      }
    }
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
};

export const getSystemConfig = async (): Promise<SystemConfig | null> => {
  try {
    const { data } = supabase.storage.from('evidence').getPublicUrl('system_config.json');
    
    // 🔥 KEY FIX: Add random timestamp parameter (?t=...) 
    // This forces the browser and CDN to ignore the cache and fetch the file fresh from the server.
    const urlWithCacheBuster = `${data.publicUrl}?t=${Date.now()}`;
    
    const response = await fetch(urlWithCacheBuster, {
      cache: 'no-store', // Tell browser not to cache
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    }); 

    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    console.error('Error fetching system config:', e);
    return null;
  }
};


// --- Users Management ---
export const getUsers = async (): Promise<User[]> => {
  const { data, error } = await supabase.from('users').select('*').order('createdAt', { ascending: true });
  if (error) {
    console.error('Error fetching users:', error);
    return [];
  }
  return data || [];
};

export const saveUser = async (user: User): Promise<void> => {
  const { error } = await supabase.from('users').upsert(user);
  if (error) console.error('Error saving user:', error);
  };

// Super Admin Function to update any user
export const updateAnyUser = async (user: User): Promise<boolean> => {
  const { error } = await supabase.from('users').update({
    balance: user.balance,
    phone: user.phone,
    role: user.role
  }).eq('id', user.id);
  
  if (error) {
    console.error('Update user error', error);
    return false;
  }
  return true;
};

export const updateUserBalance = async (userId: string, amountChange: number): Promise<void> => {
  // First get current
  const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
  if (user) {
    const newBalance = (Number(user.balance) || 0) + Number(amountChange);
    await supabase.from('users').update({ balance: newBalance }).eq('id', userId);
  }
};

export const changePassword = async (userId: string, newPass: string): Promise<void> => {
  // Only updates Auth system. Does not touch 'users' table because 'users' table should not store passwords.
  const { error } = await supabase.auth.updateUser({ password: newPass });
  if (error) console.error("Error updating auth password:", error);
};

// --- Appeals ---
export const getAppeals = async (): Promise<Appeal[]> => {
  const { data, error } = await supabase.from('appeals').select('*').order('createdAt', { ascending: false });
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
};

export const saveAppeal = async (appeal: Appeal): Promise<{ error: any }> => {
  const { error } = await supabase.from('appeals').upsert(appeal);
  if (error) console.error('Error saving appeal:', error);
  return { error };
};

// --- Transactions ---
export const getTransactions = async (): Promise<Transaction[]> => {
  const { data, error } = await supabase.from('transactions').select('*').order('createdAt', { ascending: false });
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
};

export const saveTransaction = async (tx: Transaction): Promise<{ error: any }> => {
  const { error } = await supabase.from('transactions').upsert(tx);
  if (error) console.error('Error saving transaction:', error);
  return { error };
};

// --- V2 AI Knowledge Base (BRAIN) ---

export const getKnowledgeBase = async (): Promise<KnowledgeBaseItem[]> => {
  const { data, error } = await supabase
    .from('knowledge_base')
    .select('*')
    .order('usageCount', { ascending: false });
  
  if (error) {
    console.warn("Could not fetch knowledge base. Table might not exist yet.", error.message);
    return [];
  }
  return data || [];
};

export const addToKnowledgeBase = async (item: KnowledgeBaseItem): Promise<{ success: boolean, error?: any }> => {
  const { error } = await supabase.from('knowledge_base').insert(item);
  if (error) {
    console.error("Error adding to KB:", error);
    return { success: false, error };
  }
  return { success: true };
};

export const deleteFromKnowledgeBase = async (id: string): Promise<void> => {
  await supabase.from('knowledge_base').delete().eq('id', id);
};

// Simple vector-like search (filtering by text matches) since we don't have pgvector
export const searchKnowledgeBase = async (type: string, subType: string, limit = 3): Promise<KnowledgeBaseItem[]> => {
  const { data, error } = await supabase
    .from('knowledge_base')
    .select('*')
    .eq('type', type)
    .eq('subType', subType)
    .order('usageCount', { ascending: false })
    .limit(limit);

  if (error) return [];
  return data || [];
};

// NEW: Increment Usage Count
export const incrementKbUsage = async (items: KnowledgeBaseItem[]): Promise<void> => {
  // Since we don't have a batch update stored procedure in this simple setup,
  // we perform optimistic updates or simple individual updates.
  // For robustness in this demo environment, we loop. In production, use RPC.
  for (const item of items) {
     const newCount = (item.usageCount || 0) + 1;
     await supabase.from('knowledge_base').update({ usageCount: newCount }).eq('id', item.id);
  }
};