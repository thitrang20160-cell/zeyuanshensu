import React, { useState } from 'react';
import { User } from '../types';
import { signIn, signUp } from '../services/storageService';
import { Eye, EyeOff, ShieldCheck, UserPlus, LogIn, Loader2, Mail } from 'lucide-react';

interface LoginProps {
  onLogin: (user: User) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [msg, setMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    setIsLoading(true);

    if (!email || !password) {
      setError('请输入邮箱和密码');
      setIsLoading(false);
      return;
    }
    
    if (password.length < 6) {
      setError('密码长度至少为6位');
      setIsLoading(false);
      return;
    }

    try {
      if (isRegistering) {
        // Register with Supabase Auth
        const { user, error: regError } = await signUp(email, password);
        
        if (regError) {
          setError(regError);
        } else if (user) {
          // Auto login or prompt
          setMsg('注册成功！正在为您自动登录...');
          onLogin(user);
        }
      } else {
        // Login with Supabase Auth
        const { user, error: loginError } = await signIn(email, password);
        
        if (loginError) {
          setError(loginError);
        } else if (user) {
          onLogin(user);
        }
      }
    } catch (err) {
      console.error(err);
      setError('网络连接错误，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setIsRegistering(!isRegistering);
    setError('');
    setMsg('');
    setEmail('');
    setPassword('');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh]">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
        <div className="bg-brand-600 p-8 text-center">
          <ShieldCheck className="w-16 h-16 text-white mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white">
            {isRegistering ? '注册新账户' : '泽远跨境申诉 V2'}
          </h2>
          <p className="text-brand-100 mt-2">
            {isRegistering ? '创建您的专属申诉后台' : 'V2 内测版 • AI 智能内核'}
          </p>
        </div>

        <div className="p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                电子邮箱
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                  placeholder="name@example.com"
                  autoComplete="username"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                密码
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                  placeholder="至少6位字符"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm font-medium animate-pulse flex items-center gap-2">
                 <AlertCircleIcon size={16} /> {error}
              </div>
            )}
            
            {msg && (
               <div className="p-3 rounded-lg bg-green-50 text-green-600 text-sm font-medium flex items-center gap-2">
                 <CheckCircleIcon size={16} /> {msg}
               </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-brand-600 hover:bg-brand-700 disabled:bg-brand-400 text-white font-semibold rounded-lg shadow-md transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? <Loader2 className="animate-spin" size={20} /> : (isRegistering ? <UserPlus size={20} /> : <LogIn size={20} />)}
              {isRegistering ? '立即注册' : '安全登录 V2'}
            </button>
          </form>

          <div className="mt-6 flex flex-col gap-3 text-center">
            <button
              onClick={toggleMode}
              className="text-sm text-brand-600 hover:text-brand-800 font-medium"
            >
              {isRegistering ? '已有账号？去登录' : '还没有账号？免费注册'}
            </button>
          </div>
        </div>
      </div>
      <p className="mt-8 text-xs text-gray-400">
        系统自动识别管理员权限，无需单独入口
      </p>
    </div>
  );
};

// Simple icons for local use
const AlertCircleIcon = ({size}: {size: number}) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
);

const CheckCircleIcon = ({size}: {size: number}) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
);