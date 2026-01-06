import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    // Auto dismiss after 3 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-3 pointer-events-none">
        {toasts.map(toast => (
          <div 
            key={toast.id}
            className={`
              pointer-events-auto min-w-[300px] max-w-sm p-4 rounded-xl shadow-xl border-l-4 transform transition-all animate-in slide-in-from-right fade-in duration-300 flex items-start gap-3 bg-white
              ${toast.type === 'success' ? 'border-green-500' : toast.type === 'error' ? 'border-red-500' : 'border-blue-500'}
            `}
          >
            {toast.type === 'success' && <CheckCircle className="text-green-500 shrink-0" size={22} />}
            {toast.type === 'error' && <AlertCircle className="text-red-500 shrink-0" size={22} />}
            {toast.type === 'info' && <Info className="text-blue-500 shrink-0" size={22} />}
            
            <div className="flex-1">
              <p className="text-sm font-bold text-gray-800">
                {toast.type === 'success' ? '操作成功' : toast.type === 'error' ? '操作失败' : '提示'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{toast.message}</p>
            </div>
            
            <button onClick={() => removeToast(toast.id)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
};
