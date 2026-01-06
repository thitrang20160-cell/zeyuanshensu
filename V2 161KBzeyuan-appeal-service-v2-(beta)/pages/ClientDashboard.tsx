import React, { useState, useEffect, useCallback } from 'react';
import { User, Appeal, Transaction, AppealStatus, TransactionType, TransactionStatus } from '../types';
import { getAppeals, saveAppeal, getTransactions, saveTransaction, changePassword, uploadAppealEvidence, supabase, getSystemConfig } from '../services/storageService';
import { 
  PlusCircle, History, CreditCard, Lock, FileText, Upload, 
  AlertCircle, CheckCircle, XCircle, Clock, ShieldCheck,
  Globe, Monitor, Server, Cpu, MoreHorizontal, Loader2, Bell,
  FileSpreadsheet, File, QrCode, Phone, MessageSquare, Megaphone, Copy, ArrowRight,
  TrendingUp, Activity, Users, Flame
} from 'lucide-react';
import { useToast } from '../components/Toast';

interface ClientDashboardProps {
  currentUser: User;
  refreshUser: () => Promise<void>;
}

interface PlatformStats {
  totalCases: number;
  successRate: string;
  processingCount: number;
}

export const ClientDashboard: React.FC<ClientDashboardProps> = ({ currentUser, refreshUser }) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'submit' | 'history' | 'recharge' | 'security'>('submit');
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Platform Statistics State
  const [stats, setStats] = useState<PlatformStats>({ totalCases: 3680, successRate: '98.8', processingCount: 24 });

  // Submit Form State
  const [accountType, setAccountType] = useState('紫鸟');
  const [loginInfo, setLoginInfo] = useState('');
  const [emailAccount, setEmailAccount] = useState('');
  const [emailPass, setEmailPass] = useState('');
  const [description, setDescription] = useState(''); 
  
  // File handling state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  
  const [rechargeAmount, setRechargeAmount] = useState<number>(0);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  
  // Contact Admin State
  const [adminContact, setAdminContact] = useState('');
  const [showContactModal, setShowContactModal] = useState(false);

  // Copy State
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Password & Phone State
  const [newPassword, setNewPassword] = useState('');
  const [phone, setPhone] = useState(currentUser.phone || '');

  // Ticker State
  const [currentTickerIndex, setCurrentTickerIndex] = useState(0);
  const tickers = [
    "恭喜用户 zhan*** 成功解封店铺 (3分钟前)",
    "恭喜用户 shop*** 成功解封店铺 (8分钟前)",
    "恭喜用户 amz*** 成功解封店铺 (15分钟前)",
    "恭喜用户 wlm*** 成功解封店铺 (22分钟前)",
    "恭喜用户 top*** 成功解封店铺 (半小时前)",
  ];

  const ACCOUNT_OPTIONS = [
    { value: '紫鸟', label: '紫鸟', icon: Globe },
    { value: '战斧', label: '战斧', icon: Monitor },
    { value: '牛卖', label: '牛卖', icon: Cpu },
    { value: 'VPS', label: 'VPS', icon: Server },
    { value: '其他', label: '其他', icon: MoreHorizontal },
  ];

  // Ticker Effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTickerIndex((prev) => (prev + 1) % tickers.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Initial Data Load
  const loadData = useCallback(async () => {
    // Parallel fetch for speed
    const [allAppeals, allTxs, config] = await Promise.all([
      getAppeals(),
      getTransactions(),
      getSystemConfig()
    ]);

    // --- Calculate Platform Stats (Realtime + Marketing Baseline from Config) ---
    // 基数：让平台看起来运营了很久 (Social Proof)
    const BASE_CASES = config?.marketingBaseCases ?? 3680;
    const BASE_PROCESSING = config?.marketingBaseProcessing ?? 18;
    
    const realTotal = allAppeals.length;
    const realProcessing = allAppeals.filter(a => a.status === AppealStatus.PENDING || a.status === AppealStatus.PROCESSING).length;
    const realPassed = allAppeals.filter(a => a.status === AppealStatus.PASSED).length;
    const realRejected = allAppeals.filter(a => a.status === AppealStatus.REJECTED).length;
    const realClosed = realPassed + realRejected;

    // Success Rate Logic:
    let displayRate = config?.marketingSuccessRate || '98.8';
    if (realClosed > 20) {
       const realRate = (realPassed / realClosed) * 100;
       displayRate = realRate.toFixed(1);
    } else if (realClosed > 0) {
       const baseRateVal = parseFloat(displayRate) / 100;
       const weightedRate = (baseRateVal * 50 + (realPassed / realClosed) * realClosed) / (50 + realClosed) * 100;
       displayRate = weightedRate.toFixed(1);
    }

    setStats({
      totalCases: BASE_CASES + realTotal,
      successRate: displayRate,
      processingCount: BASE_PROCESSING + realProcessing
    });

    setAppeals(allAppeals.filter(a => a.userId === currentUser.id));
    setTransactions(allTxs.filter(t => t.userId === currentUser.id));
    
    // Load config (Contact & QR)
    if (config) {
      if (config.contactInfo) setAdminContact(config.contactInfo);
      if (config.paymentQrUrl) setQrCodeUrl(config.paymentQrUrl);
    }

    await refreshUser();
  }, [currentUser.id, refreshUser]);

  useEffect(() => {
    loadData();

    // --- REALTIME SUBSCRIPTIONS ---
    const appealChannel = supabase.channel('client-appeals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appeals' }, (payload) => {
        loadData(); 
      })
      .subscribe();

    const txChannel = supabase.channel('client-txs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, (payload) => {
        const newRecord = payload.new as Transaction;
        if (newRecord && newRecord.userId === currentUser.id) {
           loadData();
        }
      })
      .subscribe();

    const userChannel = supabase.channel('client-balance')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${currentUser.id}` }, () => {
         refreshUser();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(appealChannel);
      supabase.removeChannel(txChannel);
      supabase.removeChannel(userChannel);
    };
  }, [loadData, currentUser.id, refreshUser]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        showToast("文件大小不能超过 10MB", 'error');
        return;
      }
      setSelectedFile(file);
      if (file.type.startsWith('image/')) {
        const objectUrl = URL.createObjectURL(file);
        setPreviewUrl(objectUrl);
      } else {
        setPreviewUrl('');
      }
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    setPreviewUrl('');
    const fileInput = document.getElementById('file-upload') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  };

  const getFileIcon = (file: File) => {
    if (file.name.endsWith('.xls') || file.name.endsWith('.xlsx')) return <FileSpreadsheet className="text-green-600" size={32} />;
    if (file.name.endsWith('.pdf')) return <FileText className="text-red-500" size={32} />;
    if (file.name.endsWith('.doc') || file.name.endsWith('.docx')) return <FileText className="text-blue-600" size={32} />;
    return <File className="text-gray-500" size={32} />;
  }

  const handleSubmitAppeal = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (currentUser.balance <= 0) {
      showToast('余额不足，请先充值才能提交新的申诉。', 'error');
      setLoading(false);
      return;
    }

    if (!loginInfo || !emailAccount || !emailPass) {
      showToast('请填写所有必填信息', 'error');
      setLoading(false);
      return;
    }

    try {
      let fileUrl = '';
      if (selectedFile) {
        const uploadedUrl = await uploadAppealEvidence(selectedFile);
        if (!uploadedUrl) {
          showToast('文件上传失败，请重试', 'error');
          setLoading(false);
          return;
        }
        fileUrl = uploadedUrl;
      }

      const newAppeal: Appeal = {
        id: `appeal-${Date.now()}`,
        userId: currentUser.id,
        username: currentUser.username,
        accountType,
        loginInfo,
        emailAccount,
        emailPass,
        description, 
        screenshot: fileUrl,
        status: AppealStatus.PENDING,
        adminNotes: '',
        deductionAmount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const { error } = await saveAppeal(newAppeal);
      if (error) throw error;
      
      showToast('申诉提交成功！后台正在审核。', 'success');
      // Switch to history tab automatically to show them the new record
      setTimeout(() => setActiveTab('history'), 1500);
      
      setLoginInfo('');
      setEmailAccount('');
      setEmailPass('');
      setDescription('');
      clearFile();
    } catch (err: any) {
      console.error(err);
      showToast(err.message || '提交失败，请重试', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRecharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rechargeAmount <= 0) {
      showToast('充值金额必须大于 0', 'error');
      return;
    }
    setLoading(true);

    const tx: Transaction = {
      id: `tx-${Date.now()}`,
      userId: currentUser.id,
      username: currentUser.username,
      type: TransactionType.RECHARGE,
      amount: rechargeAmount,
      status: TransactionStatus.PENDING,
      createdAt: new Date().toISOString(),
      note: '客户在线充值申请'
    };
    
    const { error } = await saveTransaction(tx);
    
    if (error) {
      showToast('提交失败: ' + error.message, 'error');
    } else {
      setRechargeAmount(0);
      showToast('充值申请已提交，等待管理员确认', 'success');
    }
    setLoading(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      showToast('密码至少需要6位', 'error');
      return;
    }
    await changePassword(currentUser.id, newPassword);
    showToast('密码修改成功', 'success');
    setNewPassword('');
  };

  const copyOrderToClipboard = (appeal: Appeal) => {
    const text = `老板，我在网站提了新的申诉，单号：${appeal.id.substring(appeal.id.length - 6)}，账号：${appeal.emailAccount}，麻烦优先处理一下！`;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(appeal.id);
      showToast('工单信息已复制，请发给客服', 'success');
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const renderStatusProgress = (status: string) => {
     let progress = 10;
     let color = 'bg-gray-200';
     
     if (status === AppealStatus.PENDING) { progress = 25; color = 'bg-blue-400'; }
     else if (status === AppealStatus.PROCESSING) { progress = 50; color = 'bg-blue-600'; }
     else if (status === AppealStatus.FOLLOW_UP) { progress = 75; color = 'bg-orange-500'; }
     else if (status === AppealStatus.PASSED) { progress = 100; color = 'bg-green-500'; }
     else if (status === AppealStatus.REJECTED) { progress = 100; color = 'bg-red-500'; }

     return (
       <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2 overflow-hidden">
         <div className={`h-1.5 rounded-full ${color} transition-all duration-1000`} style={{ width: `${progress}%` }}></div>
       </div>
     );
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      
      {/* 1. High Priority Announcement Banner */}
      <div className="bg-gradient-to-r from-brand-600 to-blue-500 rounded-xl shadow-md p-4 text-white flex items-center justify-between animate-in slide-in-from-top-2">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 p-2 rounded-lg">
             <Megaphone className="text-white" size={20} />
          </div>
          <div>
            <h3 className="font-bold text-sm sm:text-base">网站提交自动优先处理</h3>
            <p className="text-xs sm:text-sm text-blue-100 opacity-90">系统自动排单，比微信发单处理速度快 30%</p>
          </div>
        </div>
        <button 
          onClick={() => setActiveTab('submit')}
          className="hidden sm:flex bg-white text-brand-600 px-4 py-1.5 rounded-lg text-sm font-bold items-center gap-1 hover:bg-gray-50 transition-colors"
        >
          立即提交 <ArrowRight size={14} />
        </button>
      </div>

      {/* NEW: Rolling Success Ticker */}
      <div className="bg-orange-50 border border-orange-100 rounded-lg p-2.5 flex items-center gap-3 overflow-hidden">
         <div className="bg-orange-100 text-orange-600 p-1 rounded">
           <Flame size={16} className="animate-pulse" />
         </div>
         <div className="flex-1 overflow-hidden relative h-5">
            <div className="absolute transition-all duration-500 ease-in-out w-full" style={{ transform: `translateY(-${currentTickerIndex * 20}px)` }}>
               {tickers.map((text, idx) => (
                 <div key={idx} className="h-5 flex items-center text-xs sm:text-sm font-medium text-orange-700 truncate">
                   {text}
                 </div>
               ))}
            </div>
         </div>
      </div>

      {/* 2. Platform Statistics Section (TRUST BOOSTER) */}
      <div className="grid grid-cols-3 gap-3 sm:gap-6 animate-in fade-in slide-in-from-top-4 duration-500">
        <div className="bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3 sm:gap-4 hover:shadow-md transition-shadow">
           <div className="p-2 sm:p-3 bg-blue-50 text-blue-600 rounded-lg">
             <ShieldCheck size={24} className="w-5 h-5 sm:w-6 sm:h-6" />
           </div>
           <div>
             <p className="text-gray-400 text-[10px] sm:text-xs font-medium uppercase tracking-wider">累计成功解封</p>
             <p className="text-lg sm:text-2xl font-extrabold text-gray-900 tabular-nums">{stats.totalCases.toLocaleString()}</p>
           </div>
        </div>
        
        <div className="bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3 sm:gap-4 hover:shadow-md transition-shadow">
           <div className="p-2 sm:p-3 bg-green-50 text-green-600 rounded-lg">
             <TrendingUp size={24} className="w-5 h-5 sm:w-6 sm:h-6" />
           </div>
           <div>
             <p className="text-gray-400 text-[10px] sm:text-xs font-medium uppercase tracking-wider">历史申诉成功率</p>
             <p className="text-lg sm:text-2xl font-extrabold text-green-600 tabular-nums">{stats.successRate}%</p>
           </div>
        </div>
        
        <div className="bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3 sm:gap-4 hover:shadow-md transition-shadow">
           <div className="p-2 sm:p-3 bg-orange-50 text-orange-600 rounded-lg">
             <Activity size={24} className="w-5 h-5 sm:w-6 sm:h-6" />
           </div>
           <div>
             <p className="text-gray-400 text-[10px] sm:text-xs font-medium uppercase tracking-wider">当前排队处理</p>
             <p className="text-lg sm:text-2xl font-extrabold text-orange-500 tabular-nums flex items-center gap-1">
               {stats.processingCount} <span className="text-[10px] sm:text-xs font-normal text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full hidden sm:inline">火爆</span>
             </p>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar Navigation - Optimized for Mobile */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100 text-center relative overflow-hidden flex flex-col items-center justify-center">
              <div className="absolute top-0 left-0 w-full h-1 bg-brand-500"></div>
              <h3 className="text-gray-500 text-xs font-medium uppercase tracking-wide">当前账户余额</h3>
              <p className="text-3xl font-extrabold text-brand-600 mt-1">¥{currentUser.balance.toFixed(2)}</p>
          </div>

          {/* Desktop Nav (Vertical) + Mobile Nav (Horizontal Grid) */}
          <nav className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100 grid grid-cols-4 lg:grid-cols-1 divide-x lg:divide-x-0 lg:divide-y divide-gray-100">
            <button
              onClick={() => setActiveTab('submit')}
              className={`flex flex-col lg:flex-row items-center lg:gap-3 p-3 lg:px-6 lg:py-4 text-center lg:text-left transition-all ${activeTab === 'submit' ? 'bg-brand-50 text-brand-700 lg:border-l-4 lg:border-brand-600' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <PlusCircle size={22} className="mb-1 lg:mb-0" />
              <span className="text-xs lg:text-base font-medium">提交申诉</span>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex flex-col lg:flex-row items-center lg:gap-3 p-3 lg:px-6 lg:py-4 text-center lg:text-left transition-all ${activeTab === 'history' ? 'bg-brand-50 text-brand-700 lg:border-l-4 lg:border-brand-600' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <History size={22} className="mb-1 lg:mb-0" />
              <span className="text-xs lg:text-base font-medium">我的记录</span>
            </button>
            <button
              onClick={() => setActiveTab('recharge')}
              className={`flex flex-col lg:flex-row items-center lg:gap-3 p-3 lg:px-6 lg:py-4 text-center lg:text-left transition-all ${activeTab === 'recharge' ? 'bg-brand-50 text-brand-700 lg:border-l-4 lg:border-brand-600' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <CreditCard size={22} className="mb-1 lg:mb-0" />
              <span className="text-xs lg:text-base font-medium">充值中心</span>
            </button>
             <button
              onClick={() => setActiveTab('security')}
              className={`flex flex-col lg:flex-row items-center lg:gap-3 p-3 lg:px-6 lg:py-4 text-center lg:text-left transition-all ${activeTab === 'security' ? 'bg-brand-50 text-brand-700 lg:border-l-4 lg:border-brand-600' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <Lock size={22} className="mb-1 lg:mb-0" />
              <span className="text-xs lg:text-base font-medium">安全</span>
            </button>
          </nav>

          {/* Contact Admin Button - Hidden on mobile, handled by modal inside pages if needed or kept here for desktop */}
          <button 
            onClick={() => setShowContactModal(true)}
            className="hidden lg:flex w-full bg-blue-600 text-white rounded-xl shadow-md p-4 items-center justify-center gap-2 hover:bg-blue-700 transition-colors"
          >
            <MessageSquare size={20} /> 联系客服/管理员
          </button>
        </div>

        {/* Main Content Area */}
        <div className="lg:col-span-3">
          
          {/* SUBMIT TAB */}
          {activeTab === 'submit' && (
            <div className="bg-white rounded-xl shadow-sm p-5 sm:p-8 border border-gray-100 relative animate-in fade-in duration-300">
              {loading && <div className="absolute inset-0 bg-white/50 z-10 flex items-center justify-center backdrop-blur-sm rounded-xl"><Loader2 className="animate-spin text-brand-600 w-8 h-8" /></div>}
              
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
                  <FileText className="text-brand-600" /> 提交申诉资料
                </h2>
                <div className="hidden sm:block text-xs text-brand-600 bg-brand-50 px-2 py-1 rounded-md font-medium">
                  • 资料越详细，通过率越高
                </div>
              </div>
              
              <form onSubmit={handleSubmitAppeal} className="space-y-5 sm:space-y-6">
                {/* Account Type Selection - Icon Boxes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">选择环境类型</label>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
                    {ACCOUNT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setAccountType(opt.value)}
                        className={`
                          flex flex-col items-center justify-center p-2 sm:p-3 rounded-xl border-2 transition-all cursor-pointer outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1
                          ${accountType === opt.value
                            ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-sm'
                            : 'border-gray-100 bg-white text-gray-500 hover:border-brand-200 hover:bg-gray-50'
                          }
                        `}
                      >
                        <opt.icon className={`w-5 h-5 sm:w-6 sm:h-6 mb-1 sm:mb-2 ${accountType === opt.value ? 'text-brand-600' : 'text-gray-400'}`} />
                        <span className="text-[10px] sm:text-sm font-medium">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                  <div>
                     <label className="block text-sm font-medium text-gray-700 mb-1.5">店铺邮箱</label>
                     <input
                      type="text"
                      value={emailAccount}
                      onChange={(e) => setEmailAccount(e.target.value)}
                      placeholder="example@gmail.com"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-shadow"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">店铺邮箱密码</label>
                     <input
                        type="text"
                        value={emailPass}
                        onChange={(e) => setEmailPass(e.target.value)}
                        placeholder="请输入邮箱密码"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-shadow"
                      />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">登录子账号/Cookie/VPS信息</label>
                  <textarea
                    value={loginInfo}
                    onChange={(e) => setLoginInfo(e.target.value)}
                    rows={3}
                    placeholder="请输入紫鸟/战斧等子账号信息，或者VPS的IP/账号/密码..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-shadow"
                  />
                </div>

                {/* NEW DESCRIPTION FIELD */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">申诉情况描述 (如有)</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder="可简单描述账户暂停情况，如有暂停邮件请将截图上传附件"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-shadow bg-gray-50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    附件凭证 (支持图片、Excel、Word、PDF)
                  </label>
                  <div className="relative border-2 border-dashed border-gray-300 rounded-lg p-6 flex flex-col items-center justify-center text-center hover:bg-gray-50 transition-colors group">
                     {selectedFile ? (
                       <div className="relative flex flex-col items-center">
                         {/* Preview Logic */}
                         {previewUrl ? (
                            <img src={previewUrl} alt="Preview" className="max-h-48 rounded shadow-sm mb-2" />
                         ) : (
                            <div className="bg-gray-100 p-4 rounded-lg mb-2">
                              {getFileIcon(selectedFile)}
                            </div>
                         )}
                         <span className="text-sm font-medium text-gray-700 max-w-xs truncate">{selectedFile.name}</span>
                         <span className="text-xs text-gray-400">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</span>
                         
                         <button
                          type="button"
                          onClick={clearFile}
                          className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full p-1.5 shadow hover:bg-red-600 transition-colors z-10"
                         >
                           <XCircle size={16} />
                         </button>
                       </div>
                     ) : (
                       <>
                        <Upload className="w-8 h-8 text-gray-400 mb-2 group-hover:text-brand-500 transition-colors" />
                        <p className="text-sm text-gray-500">点击上传或拖拽文件至此</p>
                        <p className="text-xs text-gray-400 mt-1">支持 jpg, png, xlsx, docx, pdf (Max 10MB)</p>
                        <input 
                          id="file-upload"
                          type="file" 
                          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" 
                          onChange={handleFileChange} 
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                        />
                       </>
                     )}
                  </div>
                </div>

                <div className="pt-4 pb-20 sm:pb-0">
                   <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 sm:py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-2 hover:shadow-lg transform active:scale-95"
                   >
                     提交申诉
                   </button>
                   <p className="text-xs text-center text-gray-400 mt-3">只有余额充足时才能提交</p>
                </div>
              </form>
            </div>
          )}

          {/* HISTORY TAB */}
          {activeTab === 'history' && (
             <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 border border-gray-100 min-h-[500px] animate-in fade-in duration-300">
               <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <History className="text-brand-600" /> 我的申诉记录
              </h2>
              
              {appeals.length === 0 ? (
                <div className="text-center py-20 text-gray-400">暂无申诉记录</div>
              ) : (
                <div className="space-y-4">
                  {appeals.map((appeal) => (
                    <div key={appeal.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-all bg-white group">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-800 text-lg">{appeal.accountType}</span>
                          <span className="text-sm text-gray-500 hidden sm:inline">| {appeal.emailAccount}</span>
                        </div>
                        <div className="mt-2 sm:mt-0 flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                           <span className="text-xs text-gray-400 sm:hidden">{appeal.emailAccount}</span>
                           <span className={`px-3 py-1 rounded-full text-xs font-bold shadow-sm flex items-center gap-1
                             ${appeal.status === AppealStatus.PASSED ? 'bg-green-100 text-green-700' : 
                               appeal.status === AppealStatus.REJECTED ? 'bg-red-100 text-red-700' :
                               appeal.status === AppealStatus.FOLLOW_UP ? 'bg-orange-100 text-orange-700' :
                               appeal.status === AppealStatus.PROCESSING ? 'bg-blue-100 text-blue-700' :
                               'bg-gray-100 text-gray-700'
                             }
                           `}>
                             {appeal.status === AppealStatus.FOLLOW_UP && appeal.statusDetail 
                                ? appeal.statusDetail 
                                : appeal.status}
                           </span>
                        </div>
                      </div>
                      
                      {/* Visual Progress Bar */}
                      {renderStatusProgress(appeal.status)}
                      <div className="flex justify-between text-[10px] text-gray-400 mt-1 mb-3">
                        <span>提交</span>
                        <span>处理中</span>
                        <span>出结果</span>
                      </div>

                      <div className="bg-gray-50 p-3 rounded text-sm text-gray-600 mb-3 group-hover:bg-gray-100 transition-colors">
                        <p className="mb-1 text-xs sm:text-sm truncate"><span className="font-semibold">登录:</span> {appeal.loginInfo}</p>
                        {appeal.description && (
                          <p className="mt-2 pt-2 border-t border-gray-200 text-xs sm:text-sm line-clamp-2"><span className="font-semibold">描述:</span> {appeal.description}</p>
                        )}
                      </div>

                      {appeal.adminNotes && (
                        <div className="bg-blue-50 border-l-4 border-brand-500 p-3 rounded text-sm text-gray-700 animate-in slide-in-from-left-2 mb-3">
                          <p className="font-semibold text-brand-800 mb-1 flex items-center gap-1"><ShieldCheck size={14}/> 官方回复:</p>
                          {appeal.adminNotes}
                        </div>
                      )}
                      
                      <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <span>提交时间: {new Date(appeal.createdAt).toLocaleString()}</span>
                        
                        <div className="flex items-center gap-3 w-full sm:w-auto justify-between">
                           {appeal.deductionAmount > 0 && (
                            <span className="text-red-500 font-medium">已扣费: ¥{appeal.deductionAmount}</span>
                          )}
                          
                          {/* Wechat Bridge Button */}
                          <button 
                            onClick={() => copyOrderToClipboard(appeal)}
                            className={`flex items-center gap-1 px-3 py-1.5 rounded-md transition-all text-xs font-bold ${
                              copiedId === appeal.id 
                              ? 'bg-green-500 text-white' 
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {copiedId === appeal.id ? <CheckCircle size={12}/> : <Copy size={12}/>}
                            {copiedId === appeal.id ? '已复制' : '复制发给客服'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
             </div>
          )}

          {/* RECHARGE TAB */}
          {activeTab === 'recharge' && (
            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 animate-in fade-in duration-300">
               <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <CreditCard className="text-brand-600" /> 账户充值
              </h2>

              <div className="bg-blue-50 p-4 rounded-lg mb-6 text-brand-800 text-sm border border-blue-100 flex items-start gap-3">
                <Bell size={18} className="mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p>1. 请先点击下方“<span className="font-bold">查看官方收款码</span>”按钮，扫描进行转账付款。</p>
                  <p>2. 付款完成后，请在此页面填写金额并提交申请。</p>
                  <p>3. 管理员核实款项后（通常5分钟内），余额将自动更新。</p>
                </div>
              </div>

              <form onSubmit={handleRecharge} className="mb-8 max-w-lg">
                <div className="mb-6">
                  <button 
                    type="button" 
                    onClick={() => setShowQrModal(true)}
                    className="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg shadow hover:shadow-lg transition-all flex items-center justify-center gap-2 font-bold transform active:scale-95"
                  >
                    <QrCode size={20} /> 点击查看官方收款码
                  </button>
                </div>

                <label className="block text-sm font-medium text-gray-700 mb-2">充值金额 (RMB)</label>
                <div className="flex gap-4">
                  <input
                    type="number"
                    min="1"
                    value={rechargeAmount}
                    onChange={(e) => setRechargeAmount(parseFloat(e.target.value))}
                    placeholder="请输入您刚刚转账的金额"
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-shadow"
                  />
                  <button type="submit" className="px-6 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium transition-colors shadow-sm whitespace-nowrap">
                    提交申请
                  </button>
                </div>
              </form>

              <h3 className="text-lg font-bold text-gray-800 mb-4">充值记录</h3>
               <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">时间</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">类型</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">金额</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {transactions.map(tx => (
                        <tr key={tx.id}>
                          <td className="px-4 py-2 text-xs text-gray-500">{new Date(tx.createdAt).toLocaleDateString()}</td>
                          <td className="px-4 py-2 text-xs">{tx.type}</td>
                          <td className={`px-4 py-2 text-xs font-bold ${tx.type === TransactionType.RECHARGE ? 'text-green-600' : 'text-red-600'}`}>
                            {tx.type === TransactionType.RECHARGE ? '+' : '-'}{tx.amount}
                          </td>
                          <td className="px-4 py-2 text-xs">
                             <span className={`px-2 py-0.5 rounded text-[10px] ${
                               tx.status === TransactionStatus.APPROVED ? 'bg-green-100 text-green-700' :
                               tx.status === TransactionStatus.REJECTED ? 'bg-red-100 text-red-700' :
                               'bg-gray-100 text-gray-600'
                             }`}>
                               {tx.status}
                             </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
            </div>
          )}

          {/* QR CODE MODAL */}
          {showQrModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 p-4 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowQrModal(false)}>
              <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full relative" onClick={e => e.stopPropagation()}>
                <button onClick={() => setShowQrModal(false)} className="absolute top-3 right-3 text-gray-400 hover:text-gray-600">
                  <XCircle size={24} />
                </button>
                
                <div className="text-center">
                  <h3 className="text-lg font-bold text-gray-900 mb-1">扫码付款</h3>
                  <p className="text-sm text-gray-500 mb-4">请使用微信或支付宝扫描下方二维码</p>
                  
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 mb-4 flex items-center justify-center min-h-[200px]">
                    {qrCodeUrl ? (
                      <img src={qrCodeUrl} alt="Payment QR" className="max-w-full rounded" />
                    ) : (
                      <div className="text-gray-400 text-sm">暂未上传收款码，请联系管理员</div>
                    )}
                  </div>
                  
                  <p className="text-xs text-gray-400">付款后请在充值页面填写金额并提交申请</p>
                </div>
              </div>
            </div>
          )}

          {/* CONTACT MODAL */}
          {showContactModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 p-4 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowContactModal(false)}>
              <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full relative" onClick={e => e.stopPropagation()}>
                <button onClick={() => setShowContactModal(false)} className="absolute top-3 right-3 text-gray-400 hover:text-gray-600">
                  <XCircle size={24} />
                </button>
                <div className="text-center space-y-4">
                  <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto text-blue-600">
                    <MessageSquare size={32} />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">联系管理员/客服</h3>
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 text-left">
                    <p className="text-sm text-gray-500 mb-1">联系方式：</p>
                    <p className="text-lg font-bold text-gray-800 whitespace-pre-wrap">
                      {adminContact || '管理员暂未设置联系方式'}
                    </p>
                  </div>
                  <button onClick={() => setShowContactModal(false)} className="w-full py-2 bg-blue-600 text-white rounded-lg">知道了</button>
                </div>
              </div>
            </div>
          )}

          {/* SECURITY TAB */}
          {activeTab === 'security' && (
             <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 animate-in fade-in duration-300">
              <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <Lock className="text-brand-600" /> 安全设置
              </h2>

              {/* PASSWORD CHANGE */}
              <form onSubmit={handleChangePassword} className="max-w-md mb-8 border-b border-gray-100 pb-8">
                <div className="mb-4">
                   <label className="block text-sm font-medium text-gray-700 mb-2">修改登录密码</label>
                   <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="输入新密码"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                   />
                </div>
                <button type="submit" className="px-6 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium">
                  确认修改
                </button>
              </form>

              {/* PHONE BINDING (PLACEHOLDER) */}
              <div className="max-w-md opacity-75">
                 <h3 className="text-lg font-medium text-gray-800 mb-4 flex items-center gap-2">
                   <Phone size={20} className="text-gray-400"/> 手机号绑定 (开发中)
                 </h3>
                 <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg text-sm text-yellow-800 mb-4">
                   提示：手机验证功能暂未开放。未来将支持异地登录验证及短信找回密码。
                 </div>
                 <div className="flex gap-2">
                   <input 
                     type="text" 
                     disabled 
                     value={phone} 
                     placeholder="暂不支持绑定"
                     className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed"
                   />
                   <button disabled className="px-4 py-2 bg-gray-300 text-white rounded-lg cursor-not-allowed">
                     获取验证码
                   </button>
                 </div>
              </div>

             </div>
          )}
        </div>
      </div>
    </div>
  );
};