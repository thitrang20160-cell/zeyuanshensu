import React from 'react';
import { User, UserRole } from '../types';
import { LogOut, User as UserIcon, ShieldCheck } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  currentUser: User | null;
  onLogout: () => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, currentUser, onLogout }) => {
  const getRoleLabel = (role: UserRole) => {
    switch (role) {
      case UserRole.SUPER_ADMIN: return '超级管理员';
      case UserRole.ADMIN: return '管理员';
      default: return '客户';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-8 h-8 text-brand-600" />
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">泽远跨境 V2</h1>
              <p className="text-xs text-brand-600 font-medium">专业沃尔玛申诉服务 (内测版)</p>
            </div>
          </div>
          
          {currentUser && (
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-gray-900">
                  {getRoleLabel(currentUser.role)}: {currentUser.username}
                </p>
                {currentUser.role === UserRole.CLIENT && (
                  <p className="text-sm text-brand-600 font-bold">
                    余额: ¥{currentUser.balance.toFixed(2)}
                  </p>
                )}
              </div>
              <button
                onClick={onLogout}
                className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                title="退出登录"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
      <footer className="bg-gray-100 py-6 border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 text-center text-gray-500 text-sm">
          &copy; {new Date().getFullYear()} 泽远跨境专业申诉 V2. All rights reserved.
        </div>
      </footer>
    </div>
  );
};