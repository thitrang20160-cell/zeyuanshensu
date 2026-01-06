import React, { useState, useEffect, useCallback } from 'react';
import { User, Appeal, Transaction, AppealStatus, TransactionType, TransactionStatus, UserRole, KnowledgeBaseItem, PoaType, POA_TYPE_MAPPING } from '../types';
import { getAppeals, saveAppeal, getTransactions, saveTransaction, updateUserBalance, changePassword, supabase, uploadPaymentQr, getUsers, saveSystemConfig, getSystemConfig, updateAnyUser, getKnowledgeBase, addToKnowledgeBase, deleteFromKnowledgeBase, searchKnowledgeBase, incrementKbUsage, uploadAppealEvidence } from '../services/storageService';
import { 
  CheckCircle, XCircle, Clock, Search, Edit3, DollarSign, 
  BrainCircuit, Save, X, Filter, Loader2, Bell,
  FileText, FileSpreadsheet, Download, File, QrCode, Upload, Users, ShieldAlert, Settings, AlertTriangle, TrendingUp, RefreshCw, Eye, Sparkles, BookOpen, Trash2, Copy, FilePlus, Link, Github, Terminal, ListChecks, Calendar, Store, Hash, ChevronDown, ChevronRight, Layers, MessageSquarePlus, Table, Database
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { useToast } from '../components/Toast';

interface AdminDashboardProps {
  currentUser: User;
}

// --- Helper: Random Name Generator for POA ---
const getRandomNames = () => {
  const firstNames = ['Mike', 'David', 'Sarah', 'Jessica', 'James', 'Wei', 'Lei', 'Hui', 'Emily', 'Robert', 'Chris', 'Amanda'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Chen', 'Wang', 'Liu', 'Zhang', 'Miller', 'Davis', 'Wu', 'Rodriguez', 'Lee'];
  
  const generate = () => {
    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];
    return `${first} ${last}`;
  };

  return {
    manager: generate(),
    warehouse: generate(),
    cs: generate(),
    compliance: generate()
  };
};

// --- Smart Classification Logic ---
const autoClassifyPoa = (filename: string): { type: PoaType, subType: string } | null => {
  const name = filename.toLowerCase();

  // 1. Fulfillment Suspension (自发货权限)
  if (name.includes('自发货') || name.includes('fulfillment') || name.includes('permission')) {
    if (name.includes('otd') || name.includes('late') || name.includes('迟发')) {
      return { type: PoaType.FULFILLMENT_SUSPENSION, subType: 'OTD (发货及时率低) - 暂停自发货' };
    }
    if (name.includes('vtr') || name.includes('tracking') || name.includes('追踪')) {
      return { type: PoaType.FULFILLMENT_SUSPENSION, subType: 'VTR (物流追踪率低) - 暂停自发货' };
    }
    return { type: PoaType.FULFILLMENT_SUSPENSION, subType: POA_TYPE_MAPPING[PoaType.FULFILLMENT_SUSPENSION][0] };
  }

  // 2. Account Suspension (店铺封号)
  
  // Performance (OTD/VTR)
  if (name.includes('otd') || name.includes('发货及时') || name.includes('late shipment')) {
    return { type: PoaType.ACCOUNT_SUSPENSION, subType: 'OTD (发货及时率低) - 导致封店' };
  }
  if (name.includes('vtr') || name.includes('追踪') || name.includes('valid tracking')) {
    return { type: PoaType.ACCOUNT_SUSPENSION, subType: 'VTR (物流追踪率低) - 导致封店' };
  }
  if (name.includes('cancel') || name.includes('取消率')) {
    return { type: PoaType.ACCOUNT_SUSPENSION, subType: '取消率过高 - 导致封店' };
  }

  // IP / Infringement
  if (name.includes('ip') || name.includes('infringement') || name.includes('侵权') || name.includes('rights') || name.includes('counterfeit') || name.includes('假冒')) {
     if (name.includes('trademark') || name.includes('商标')) return { type: PoaType.ACCOUNT_SUSPENSION, subType: '知识产权 - 商标侵权 (Trademark)' };
     if (name.includes('patent') || name.includes('专利')) return { type: PoaType.ACCOUNT_SUSPENSION, subType: '知识产权 - 专利侵权 (Patent)' };
     if (name.includes('copyright') || name.includes('版权')) return { type: PoaType.ACCOUNT_SUSPENSION, subType: '知识产权 - 版权侵权 (Copyright)' };
     return { type: PoaType.ACCOUNT_SUSPENSION, subType: '知识产权 - 假冒商品 (Counterfeit)' };
  }

  // Other Common Issues
  if (name.includes('linked') || name.includes('related') || name.includes('关联')) {
    return { type: PoaType.ACCOUNT_SUSPENSION, subType: '关联账户 (Related Accounts)' };
  }
  if (name.includes('review') || name.includes('manipulation') || name.includes('评论') || name.includes('刷单')) {
    return { type: PoaType.ACCOUNT_SUSPENSION, subType: '操控评论 (Review Manipulation)' };
  }
  if (name.includes('verify') || name.includes('identity') || name.includes('身份') || name.includes('二审')) {
    return { type: PoaType.ACCOUNT_SUSPENSION, subType: '二审/身份验证 (Identity Verification)' };
  }
  if (name.includes('fraud') || name.includes('欺诈')) {
    return { type: PoaType.ACCOUNT_SUSPENSION, subType: '客户欺诈投诉 (Customer Fraud Complaint)' };
  }

  return null; // Fallback to user selection
};

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ currentUser }) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'appeals' | 'finance' | 'users' | 'security' | 'brain'>('appeals');
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  
  // --- Search & Filter State ---
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Edit Modal State
  const [editingAppeal, setEditingAppeal] = useState<Appeal | null>(null);
  const [editNote, setEditNote] = useState('');
  const [editStatus, setEditStatus] = useState<AppealStatus>(AppealStatus.PENDING);
  const [editDeduction, setEditDeduction] = useState<number>(0);
  
  // V2 AI Writer State
  const [aiPoaType, setAiPoaType] = useState<PoaType>(PoaType.ACCOUNT_SUSPENSION);
  const [aiPoaSubType, setAiPoaSubType] = useState<string>(POA_TYPE_MAPPING[PoaType.ACCOUNT_SUSPENSION][0]);
  
  // NEW: Detailed Fields for AI
  const [aiRootCause, setAiRootCause] = useState('');
  const [aiStoreName, setAiStoreName] = useState('');
  const [aiPartnerId, setAiPartnerId] = useState('');
  const [aiDate, setAiDate] = useState(new Date().toISOString().split('T')[0]);
  const [aiCustomInstructions, setAiCustomInstructions] = useState(''); 
  
  // NEW: Specific Data Points for Tables
  const [aiTableExtract, setAiTableExtract] = useState(''); // Textarea for pasting excel rows
  const [aiMetricCurrent, setAiMetricCurrent] = useState(''); // e.g. 90.8%
  const [aiMetricTarget, setAiMetricTarget] = useState(''); // e.g. 99%
  const [isAnalyzingExcel, setIsAnalyzingExcel] = useState(false);

  const [aiGeneratedText, setAiGeneratedText] = useState('');
  const [isGeneratingPoa, setIsGeneratingPoa] = useState(false);
  const [aiStep, setAiStep] = useState<1 | 2>(1); // 1: Inputs, 2: Result
  const [ragReferences, setRagReferences] = useState<string[]>([]); // To show used references

  // Lightbox State
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // QR Code State
  const [currentQrUrl, setCurrentQrUrl] = useState('');
  
  // Contact & Marketing Config State
  const [contactInfo, setContactInfo] = useState('');
  const [marketingBaseCases, setMarketingBaseCases] = useState<number>(3500);
  const [marketingSuccessRate, setMarketingSuccessRate] = useState<string>('98.8');
  const [marketingBaseProcessing, setMarketingBaseProcessing] = useState<number>(15);
  
  // Security State
  const [newPassword, setNewPassword] = useState('');

  // User Management State (Super Admin)
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // Knowledge Base State
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBaseItem[]>([]);
  const [kbTitle, setKbTitle] = useState('');
  const [kbContent, setKbContent] = useState('');
  const [kbType, setKbType] = useState<PoaType>(PoaType.ACCOUNT_SUSPENSION);
  const [kbSubType, setKbSubType] = useState<string>(POA_TYPE_MAPPING[PoaType.ACCOUNT_SUSPENSION][0]);
  const [kbFileUploading, setKbFileUploading] = useState(false);
  const [kbUploadLogs, setKbUploadLogs] = useState<string[]>([]);
  
  // KB UI State (Folding)
  const [expandedKbGroups, setExpandedKbGroups] = useState<Record<string, boolean>>({
    [PoaType.ACCOUNT_SUSPENSION]: true,
    [PoaType.FULFILLMENT_SUSPENSION]: true,
    [PoaType.OTHER]: false
  });

  const isSuperAdmin = currentUser.role === UserRole.SUPER_ADMIN;
  
  // Check API Key Status immediately
  const isApiKeyConfigured = !!process.env.API_KEY;

  const loadData = useCallback(async () => {
    // Parallel fetching for performance
    const [fetchedAppeals, fetchedTxs, fetchedConfig] = await Promise.all([
      getAppeals(),
      getTransactions(),
      getSystemConfig()
    ]);
    
    setAppeals(fetchedAppeals);
    setTransactions(fetchedTxs);
    
    if (fetchedConfig) {
      setContactInfo(fetchedConfig.contactInfo || '');
      if (fetchedConfig.paymentQrUrl) {
        setCurrentQrUrl(fetchedConfig.paymentQrUrl);
      }
      setMarketingBaseCases(fetchedConfig.marketingBaseCases ?? 3500);
      setMarketingSuccessRate(fetchedConfig.marketingSuccessRate || '98.8');
      setMarketingBaseProcessing(fetchedConfig.marketingBaseProcessing ?? 15);
    }
    
    if (isSuperAdmin) {
      const u = await getUsers();
      setAllUsers(u);
    }
    
    // Load Knowledge Base
    if (isSuperAdmin) {
      const kb = await getKnowledgeBase();
      setKnowledgeBase(kb);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    loadData();

    // --- REALTIME SUBSCRIPTIONS ---
    const appealChannel = supabase.channel('admin-appeals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appeals' }, () => loadData())
      .subscribe();

    const txChannel = supabase.channel('admin-txs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => loadData())
      .subscribe();
      
    let userChannel: any;
    if (isSuperAdmin) {
       userChannel = supabase.channel('admin-users')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => loadData())
        .subscribe();
    }

    return () => {
      supabase.removeChannel(appealChannel);
      supabase.removeChannel(txChannel);
      if (userChannel) supabase.removeChannel(userChannel);
    };
  }, [loadData, isSuperAdmin]);

  // Update AI SubType when Type changes
  useEffect(() => {
    setAiPoaSubType(POA_TYPE_MAPPING[aiPoaType][0]);
  }, [aiPoaType]);

  // Update KB SubType when Type changes
  useEffect(() => {
    setKbSubType(POA_TYPE_MAPPING[kbType][0]);
  }, [kbType]);

  // Toggle KB Group
  const toggleKbGroup = (type: string) => {
    setExpandedKbGroups(prev => ({...prev, [type]: !prev[type]}));
  };

  // --- Filter Logic ---
  const filteredAppeals = appeals.filter(appeal => {
    const matchesSearch = 
      appeal.emailAccount.toLowerCase().includes(searchTerm.toLowerCase()) ||
      appeal.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
      appeal.accountType.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (appeal.id && appeal.id.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus = statusFilter === 'ALL' || appeal.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // --- CSV Export Logic ---
  const handleExportCSV = () => {
    if (filteredAppeals.length === 0) return;
    const headers = ['工单ID', '提交时间', '客户', '账号类型', '店铺邮箱', '邮箱密码', '登录信息', '状态', '扣费金额', '管理员备注'];
    const rows = filteredAppeals.map(a => [
      a.id, new Date(a.createdAt).toLocaleString(), a.username, a.accountType, a.emailAccount, a.emailPass, `"${a.loginInfo.replace(/"/g, '""')}"`, a.status, a.deductionAmount, `"${(a.adminNotes || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = "\uFEFF" + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `申诉记录导出_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleEditClick = (appeal: Appeal) => {
    setEditingAppeal(appeal);
    setEditNote(appeal.adminNotes || '');
    setEditStatus(appeal.status as AppealStatus);
    setEditDeduction(appeal.deductionAmount || 0); 
    
    // Reset AI Writer
    setAiGeneratedText('');
    setAiStep(1);
    setAiRootCause('');
    setAiStoreName('');
    setAiPartnerId('');
    setAiCustomInstructions('');
    setAiTableExtract('');
    setAiMetricCurrent('');
    setAiMetricTarget('');
    setAiDate(new Date().toISOString().split('T')[0]);
    setRagReferences([]);
    setIsAnalyzingExcel(false);
    // Default to first type
    setAiPoaType(PoaType.ACCOUNT_SUSPENSION);
  };

  const handleUploadQr = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    showToast('正在上传收款码...', 'info');
    const { url, error } = await uploadPaymentQr(file);
    if (url) {
      setCurrentQrUrl(url);
      const { success, error: configError } = await saveSystemConfig({
        contactInfo, paymentQrUrl: url, marketingBaseCases, marketingSuccessRate, marketingBaseProcessing
      });
      if (success) showToast('收款码更新成功！', 'success');
      else showToast(`图片已上传，但配置保存失败: ${configError}`, 'error');
    } else {
       showToast(error || '上传失败', 'error');
    }
  };

  const handleSaveSystemConfig = async () => {
    setLoading(true);
    const { success, error } = await saveSystemConfig({ 
      contactInfo, paymentQrUrl: currentQrUrl, marketingBaseCases, marketingSuccessRate, marketingBaseProcessing
    });
    if (success) showToast('全局配置保存成功', 'success');
    else showToast(error || '保存失败', 'error');
    setLoading(false);
  };

  // --- Excel Parsing Logic (Multi-Sheet Support) ---
  const handleAnalyzeExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzingExcel(true);
    showToast('正在分析 Excel 全部分表数据...', 'info');

    try {
       // 1. Backend Sync: Upload file to storage (archiving purpose)
       const uploadedUrl = await uploadAppealEvidence(file);
       if (!uploadedUrl) {
          console.warn('Backend upload failed, but proceeding with local analysis.');
       }

       // 2. Client-side Analysis
       const reader = new FileReader();
       reader.onload = (evt) => {
         try {
            const bstr = evt.target?.result;
            const workbook = XLSX.read(bstr, { type: 'array' });
            
            let allSheetsData = "";
            let processedCount = 0;

            // --- KEY FIX: Loop through ALL SheetNames ---
            workbook.SheetNames.forEach(sheetName => {
               const worksheet = workbook.Sheets[sheetName];
               // Convert to CSV
               const csvData = XLSX.utils.sheet_to_csv(worksheet);
               
               // Only extract if the sheet has content
               if (csvData && csvData.trim().length > 0) {
                 // Add clear delimiter for AI to recognize tabs
                 allSheetsData += `\n\n====== TAB/SHEET: "${sheetName}" ======\n${csvData}`;
                 processedCount++;
               }
            });
            
            // Truncate if too huge (Gemini 2.0 has large context but let's limit to safe 25k chars)
            const truncatedData = allSheetsData.substring(0, 25000);
            
            if (processedCount === 0) {
               showToast('Excel 文件似乎为空', 'error');
            } else {
               setAiTableExtract(truncatedData);
               showToast(`成功解析 ${processedCount} 个工作表！数据已合并填充。`, 'success');
               if(uploadedUrl) showToast('文件已同步备份至后端云存储。', 'success');
            }
         } catch (err) {
            console.error(err);
            showToast('Excel 解析失败，请检查文件格式', 'error');
         } finally {
            setIsAnalyzingExcel(false);
         }
       };
       reader.readAsArrayBuffer(file);
       
    } catch (err: any) {
       console.error(err);
       showToast('处理失败: ' + err.message, 'error');
       setIsAnalyzingExcel(false);
    }
  };

  // --- V2: Smart POA Generation Logic ---
  const generateSmartPOA = async () => {
    if (!process.env.API_KEY) {
      showToast('API Key未生效。请参考设置页面的诊断建议。', 'error');
      return;
    }

    if (!aiStoreName || !aiPartnerId) {
      showToast('请填写店铺名称和Partner ID，这对于申诉通过很重要！', 'error');
      return;
    }
    
    setIsGeneratingPoa(true);
    setRagReferences([]);
    
    try {
      // 1. Retrieval (RAG): Fetch similar successful cases
      const similarCases = await searchKnowledgeBase(aiPoaType, aiPoaSubType, 3);
      setRagReferences(similarCases.map(c => c.title)); // Capture references
      const examples = similarCases.map(c => `Example Case (${c.title}):\n${c.content}`).join('\n\n');

      if (similarCases.length > 0) {
         incrementKbUsage(similarCases);
      }

      // Generate Random Names for this session
      const staff = getRandomNames();

      // 2. Prompt Construction
      const isFulfillmentSuspension = aiPoaType === PoaType.FULFILLMENT_SUSPENSION;
      const isIpIssue = aiPoaSubType.includes('知识产权') || aiPoaSubType.includes('侵权') || aiPoaSubType.includes('IP');
      const isPerformanceIssue = aiPoaSubType.includes('OTD') || aiPoaSubType.includes('VTR') || aiPoaSubType.includes('取消率') || aiPoaSubType.includes('Rate');
      
      const todayStr = new Date().toISOString().split('T')[0];

      let systemInstruction = `You are a professional Walmart Appeal Specialist. Your task is to write a highly persuasive Plan of Action (POA).
      
      Structure:
      1. Intro (Apology, Store Name: ${aiStoreName}, PID: ${aiPartnerId})
      2. Root Cause (THE "5 WHYS" Deep Analysis)
      3. Immediate Actions (Completed actions from ${aiDate} to ${todayStr})
      4. Preventative Measures (Multi-tier Review Process)
      5. Implementation Plan (Future timeline & Personnel)
      6. Conclusion (Reinstatement request)
      
      CRITICAL WRITING RULES:
      
      1. **ROOT CAUSE - THE "5 WHYS" METHOD & MULTI-TAB ANALYSIS**:
         - **Context**: The user provided an Excel export with MULTIPLE TABS (e.g., "Late Shipment", "Carrier Delays", "No Carrier Scan").
         - **Action**: Analyze the "Table Data Extract" below. Look for headers like "====== TAB/SHEET: [Name] ======".
         - **Logic**: 
           - If data is in "Late Shipment" or "Late handover", it's a SELLER FAULT (Inventory/Staffing issue).
           - If data is in "Carrier Delays" or "No Carrier Scan", it might be a CARRIER FAULT (but Walmart still requires you to scan packages earlier).
         - **Citation**: Quote specific Order IDs/Dates from the specific tabs to prove you analyzed the data.
         - Do NOT just say "We had a delay". Drill down 5 levels (e.g., Order delayed -> Why? Inventory count wrong -> Why? Manual entry error -> Why? No scanner -> Why? Budget cut).
      
      2. **PREVENTATIVE MEASURES - MULTI-TIER REVIEW**:
         - Describe a specific workflow where multiple people check the work.
         - **Maker-Checker Principle**: "Warehouse Lead [Name1] prepares the package, and Operations Manager [Name2] performs a final 'Quality Check' scan."
         - Use the specific personnel names provided below in the "Personnel" section.

      3. **QUANTIFIABLE GOALS (SMART Criteria)**:
         - You MUST include a specific section stating: "Our goal is to reach [Target Metric] for [Metric Name] within 30 days."
         - Compare it to the [Current Metric] provided in the context.
         - Define monitoring routines (e.g., "Daily audit at 9:00 AM EST").

      4. **POLICY CITATION**:
         - You MUST explicitly reference "Walmart Seller Performance Standards" or "Walmart Intellectual Property Policy" depending on the issue.
         - Use phrases like: "We understand that under Section [X] of the Seller Agreement..."

      5. **NO LAZY ATTACHMENT REFERENCES**:
         - **STRICTLY FORBIDDEN**: Phrases like "Please see attached file", "Refer to exhibit", "See uploaded document".
         - **INSTEAD**: Describe the data inline. Say "As seen in the 'Late Shipment' tab for Order 12345...", "Our audit of ASIN B00XXXX shows..."

      6. **TIMELINE LOGIC (Future-Oriented)**:
         - **Phase A (Immediate)**: Past actions (${aiDate} to ${todayStr}).
         - **Phase B (Future)**: Future actions (${todayStr} to +90 days). 
           - Example: "On [Today+30 days], we will conduct the Q2 compliance audit."
      
      **PERSONNEL TO USE (Insert these names naturally)**:
         - Operations Lead: **${staff.manager}**
         - Warehouse Lead: **${staff.warehouse}**
         - CS Supervisor: **${staff.cs}**
         - Compliance Officer: **${staff.compliance}**
      `;

      if (isFulfillmentSuspension) {
        systemInstruction += `\nConstraint: Fulfillment Suspension POA must be under 1000 chars. Keep it concise but specific.`;
      } else {
        systemInstruction += `\nConstraint: Account Suspension POA should be detailed (800-1500 words).`;
      }

      if (isIpIssue) {
         systemInstruction += `\nIP Focus: State infringing listings are deleted. Mention inventory audit, invoice verification & IP training.`;
      }
      
      if (aiCustomInstructions) {
         systemInstruction += `\n\nUSER OVERRIDE: ${aiCustomInstructions}`;
      }

      const userContext = `
      Type: ${aiPoaType} - ${aiPoaSubType}
      Store: ${aiStoreName} (PID: ${aiPartnerId})
      Suspension Date: ${aiDate}
      Root Cause Detail (User Input): ${aiRootCause}
      
      --- SPECIFIC TABLE DATA (Contains multiple sheets, please cite specific tabs) ---
      Table Data Extract: ${aiTableExtract || 'No specific table data provided.'}
      
      Current Metric: ${aiMetricCurrent || 'N/A'}
      Target Metric: ${aiMetricTarget || 'N/A'}
      `;

      const prompt = `
      ${systemInstruction}
      
      Reference Examples (Style Guide only, do not copy dates/names):
      ${examples}
      
      Now write the POA based on the USER CONTEXT below:
      ${userContext}
      `;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash', 
        contents: prompt,
        config: { temperature: 0.7 }
      });

      let finalText = response.text || '生成失败';

      // Fallback replacements just in case
      finalText = finalText.replace(/\[Your Store Name\]/gi, aiStoreName);
      finalText = finalText.replace(/\[Store Name\]/gi, aiStoreName);
      finalText = finalText.replace(/\[Your Partner ID\]/gi, aiPartnerId);
      finalText = finalText.replace(/\[Date\]/gi, aiDate);

      setAiGeneratedText(finalText);
      setAiStep(2);

    } catch (err: any) {
      console.error(err);
      showToast('AI生成失败: ' + (err.message || '未知错误'), 'error');
    } finally {
      setIsGeneratingPoa(false);
    }
  };

  const handleDownloadDoc = () => {
    if (!aiGeneratedText) return;
    
    // Create a simple HTML document structure that Word can read
    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>POA Export</title></head><body>";
    const footer = "</body></html>";
    
    // --- MARKDOWN PARSING FOR WORD ---
    // 1. Escape HTML first to prevent XSS (basic)
    let safeText = aiGeneratedText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // 2. Convert **Bold** to <b>Bold</b>
    safeText = safeText.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

    // 3. Convert * List Items to bullet points (simple approximation)
    safeText = safeText.replace(/^\* (.*$)/gm, '• $1');
    safeText = safeText.replace(/^- (.*$)/gm, '• $1');

    // 4. Convert newlines to <br/>
    const content = safeText.replace(/\n/g, '<br/>');

    const sourceHTML = header + `<div style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; white-space: pre-wrap;">${content}</div>` + footer;

    const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
    const fileDownload = document.createElement("a");
    document.body.appendChild(fileDownload);
    fileDownload.href = source;
    // Filename: POA_StoreName_Reason_Date.doc
    fileDownload.download = `POA_${aiStoreName || 'Draft'}_${new Date().toISOString().slice(0,10)}.doc`;
    fileDownload.click();
    document.body.removeChild(fileDownload);
    showToast('文档下载已开始 (已自动排版)', 'success');
  };

  const handleSaveAppeal = async () => {
    if (!editingAppeal) return;
    setLoading(true);

    let statusDetailStr = undefined;
    if (editStatus === AppealStatus.FOLLOW_UP) {
      const now = new Date();
      statusDetailStr = `${now.getMonth() + 1}月${now.getDate()}日已跟进`;
    }

    // Deduction Logic
    if (editStatus === AppealStatus.PASSED && editingAppeal.status !== AppealStatus.PASSED && editDeduction > 0) {
      const tx: Transaction = {
        id: `deduct-${Date.now()}`,
        userId: editingAppeal.userId,
        username: editingAppeal.username,
        type: TransactionType.DEDUCTION,
        amount: editDeduction,
        status: TransactionStatus.APPROVED,
        note: `申诉通过扣费 (ID: ${editingAppeal.id})`,
        createdAt: new Date().toISOString()
      };
      
      const { error: txError } = await saveTransaction(tx);
      if (txError) {
        showToast('扣费流水创建失败: ' + txError.message, 'error');
        setLoading(false);
        return;
      }
      await updateUserBalance(editingAppeal.userId, -editDeduction);
    }

    const updatedAppeal: Appeal = {
      ...editingAppeal,
      status: editStatus,
      statusDetail: statusDetailStr,
      adminNotes: editNote,
      deductionAmount: editDeduction,
      updatedAt: new Date().toISOString()
    };

    const { error } = await saveAppeal(updatedAppeal);
    
    if (error) {
       showToast('更新失败: ' + error.message, 'error');
    } else {
       showToast('工单更新成功', 'success');
       
       // V2: Auto-Learning Trigger
       if (editStatus === AppealStatus.PASSED && aiGeneratedText && isSuperAdmin) {
          if (confirm("恭喜申诉通过！是否将刚刚 AI 生成的 POA 存入「智囊团」知识库，以供后续学习？")) {
             await addToKnowledgeBase({
               id: `kb-${Date.now()}`,
               type: aiPoaType,
               subType: aiPoaSubType,
               title: `自动归档: ${editingAppeal.username} - ${aiPoaSubType}`,
               content: aiGeneratedText,
               createdAt: new Date().toISOString(),
               usageCount: 1
             });
             showToast('已成功收录至知识库！', 'success');
          }
       }
       
       setEditingAppeal(null);
    }
    setLoading(false);
  };

  // --- Knowledge Base Management ---
  
  // Handle Docx Upload for KB (Supports Bulk & Smart Classification & Duplicate Check)
  const handleKbFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // --- BULK UPLOAD MODE ---
    if (files.length > 1) {
      setKbFileUploading(true);
      setKbUploadLogs([]);
      let successCount = 0;
      let failCount = 0;
      let skipCount = 0;
      const newLogs: string[] = [];

      // 异步处理所有文件
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        if (!file.name.endsWith('.docx')) {
           newLogs.push(`❌ 跳过: ${file.name} (非 docx)`);
           failCount++;
           continue;
        }

        try {
           const arrayBuffer = await file.arrayBuffer();
           const result = await mammoth.extractRawText({ arrayBuffer });
           
           if (result.value) {
             const cleanTitle = file.name.replace('.docx', '');

             // --- DUPLICATE CHECK ---
             // Check if title already exists in current KB state
             const isDuplicate = knowledgeBase.some(k => k.title === cleanTitle);
             if (isDuplicate) {
                newLogs.push(`⚠️ 跳过: ${cleanTitle} (已存在相同标题)`);
                skipCount++;
                continue;
             }
             
             // SMART CLASSIFICATION
             const autoCat = autoClassifyPoa(file.name);
             const finalType = autoCat ? autoCat.type : kbType;
             const finalSubType = autoCat ? autoCat.subType : kbSubType;
             
             await addToKnowledgeBase({
               id: `kb-${Date.now()}-${Math.random().toString(36).substr(2,5)}`,
               type: finalType,
               subType: finalSubType,
               title: cleanTitle,
               content: result.value,
               createdAt: new Date().toISOString(),
               usageCount: 0
             });
             
             newLogs.push(`✅ 成功: ${file.name} -> [${finalSubType}]`);
             successCount++;
           } else {
             newLogs.push(`⚠️ 失败: ${file.name} (内容为空)`);
             failCount++;
           }
        } catch (err) {
           console.error(err);
           newLogs.push(`❌ 错误: ${file.name} (解析失败)`);
           failCount++;
        }
        // Update logs
        setKbUploadLogs(prev => [...prev, newLogs[newLogs.length - 1]]);
      }
      
      showToast(`导入完成：成功 ${successCount}，跳过重复 ${skipCount}，失败 ${failCount}`, 'success');
      setKbFileUploading(false);
      e.target.value = ''; // Reset input
      loadData(); // Refresh list
      return;
    }

    // --- SINGLE FILE MODE ---
    const file = files[0];
    if (!file.name.endsWith('.docx')) {
      showToast('目前仅支持 .docx 格式的 Word 文档', 'error');
      return;
    }

    setKbFileUploading(true);
    setKbUploadLogs([]);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      
      if (result.value) {
        setKbContent(result.value);
        if (!kbTitle) {
          setKbTitle(file.name.replace('.docx', ''));
        }
        
        // Auto classify
        const autoCat = autoClassifyPoa(file.name);
        if (autoCat) {
           setKbType(autoCat.type);
           setKbSubType(autoCat.subType);
           showToast(`已根据文件名自动匹配类型：${autoCat.subType}`, 'info');
        } else {
           showToast('文档解析成功！请手动选择类型', 'success');
        }

      } else {
        showToast('文档内容为空或无法解析', 'error');
      }
    } catch (error: any) {
      console.error(error);
      showToast('解析失败: ' + error.message, 'error');
    } finally {
      setKbFileUploading(false);
      e.target.value = '';
    }
  };

  const handleAddKbItem = async () => {
    if (!kbTitle || !kbContent) return showToast('标题和内容不能为空', 'error');
    
    // Duplicate check for manual add
    if (knowledgeBase.some(k => k.title === kbTitle)) {
      return showToast('该标题的案例已存在，请勿重复添加', 'error');
    }

    const newItem: KnowledgeBaseItem = {
      id: `kb-${Date.now()}`,
      type: kbType,
      subType: kbSubType,
      title: kbTitle,
      content: kbContent,
      createdAt: new Date().toISOString(),
      usageCount: 0
    };
    
    const { success, error } = await addToKnowledgeBase(newItem);
    if (success) {
      showToast('成功录入案例', 'success');
      setKbTitle('');
      setKbContent('');
      loadData(); 
    } else {
      showToast('录入失败: ' + (error?.message || '请检查是否已创建数据库表'), 'error');
    }
  };
  
  const handleDeleteKb = async (id: string) => {
    if(!confirm('确定永久删除此案例吗？')) return;
    
    // --- OPTIMISTIC UPDATE: Remove from UI immediately ---
    setKnowledgeBase(prev => prev.filter(item => item.id !== id));
    
    await deleteFromKnowledgeBase(id);
    showToast('已删除', 'info');
    // We don't need to loadData() because we updated state locally, unless sync issues occur.
  };

  const handleApproveRecharge = async (tx: Transaction) => {
    if (tx.status !== TransactionStatus.PENDING) return;
    setLoading(true);
    const updatedTx: Transaction = { ...tx, status: TransactionStatus.APPROVED };
    const { error } = await saveTransaction(updatedTx);
    if (error) showToast('操作失败: ' + error.message, 'error');
    else {
      await updateUserBalance(tx.userId, tx.amount);
      showToast('充值已确认入账', 'success');
    }
    setLoading(false);
  };

  const handleRejectRecharge = async (tx: Transaction) => {
    if (tx.status !== TransactionStatus.PENDING) return;
    setLoading(true);
    const updatedTx: Transaction = { ...tx, status: TransactionStatus.REJECTED };
    const { error } = await saveTransaction(updatedTx);
    if (error) showToast('操作失败: ' + error.message, 'error');
    else showToast('充值申请已拒绝', 'info');
    setLoading(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) return;
    await changePassword(currentUser.id, newPassword);
    showToast('管理员密码已修改', 'success');
    setNewPassword('');
  };

  const handleSaveUser = async () => {
    if (!editingUser) return;
    setLoading(true);
    const success = await updateAnyUser(editingUser);
    if (success) {
      showToast('用户信息更新成功', 'success');
      setEditingUser(null);
      await loadData();
    } else {
      showToast('更新失败', 'error');
    }
    setLoading(false);
  };

  const renderAttachment = (url: string) => {
    const ext = url.split('.').pop()?.toLowerCase() || '';
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
    if (isImage) {
      return (
        <div onClick={() => setLightboxUrl(url)} className="mt-2 cursor-pointer group relative overflow-hidden rounded-lg border border-gray-200 w-full max-w-xs">
          <img src={url} alt="Evidence" className="w-full h-32 object-cover transition-transform group-hover:scale-105" />
          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
             <Eye className="text-white" size={24} />
          </div>
        </div>
      );
    }
    return (
      <div className="mt-2 flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
        <FileText className="text-gray-500" size={24} />
        <div className="flex-1 overflow-hidden">
          <p className="text-sm font-medium text-gray-700 truncate">附件凭证.{ext}</p>
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded flex items-center gap-1 transition-colors">
          <Download size={14} /> 下载
        </a>
      </div>
    );
  };

  const pendingAppealsCount = appeals.filter(a => a.status === AppealStatus.PENDING).length;
  const pendingRechargeCount = transactions.filter(t => t.type === TransactionType.RECHARGE && t.status === TransactionStatus.PENDING).length;

  return (
    <div className="space-y-6">
      {/* Role Badge */}
      <div className="flex justify-end">
        <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${isSuperAdmin ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
          <ShieldAlert size={14} /> {isSuperAdmin ? '超级管理员 (老板)' : '普通管理员'}
        </span>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Navigation Tabs */}
        <div className="flex border-b border-gray-200 overflow-x-auto no-scrollbar">
          <button onClick={() => setActiveTab('appeals')} className={`flex-1 py-4 text-center font-medium flex items-center justify-center gap-2 min-w-[120px] whitespace-nowrap px-4 ${activeTab === 'appeals' ? 'bg-brand-50 text-brand-700 border-b-2 border-brand-600' : 'text-gray-600 hover:bg-gray-50'}`}>
            申诉工单 {pendingAppealsCount > 0 && <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{pendingAppealsCount}</span>}
          </button>
          <button onClick={() => setActiveTab('finance')} className={`flex-1 py-4 text-center font-medium flex items-center justify-center gap-2 min-w-[120px] whitespace-nowrap px-4 ${activeTab === 'finance' ? 'bg-brand-50 text-brand-700 border-b-2 border-brand-600' : 'text-gray-600 hover:bg-gray-50'}`}>
            财务审核 {pendingRechargeCount > 0 && <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{pendingRechargeCount}</span>}
          </button>
          {isSuperAdmin && (
             <button onClick={() => setActiveTab('brain')} className={`flex-1 py-4 text-center font-medium flex items-center justify-center gap-2 min-w-[120px] whitespace-nowrap px-4 ${activeTab === 'brain' ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : 'text-gray-600 hover:bg-gray-50'}`}>
              <BrainCircuit size={18}/> AI 智囊团 (Pro 版)
            </button>
          )}
          {isSuperAdmin && (
             <button onClick={() => setActiveTab('users')} className={`flex-1 py-4 text-center font-medium flex items-center justify-center gap-2 min-w-[120px] whitespace-nowrap px-4 ${activeTab === 'users' ? 'bg-brand-50 text-brand-700 border-b-2 border-brand-600' : 'text-gray-600 hover:bg-gray-50'}`}>
              用户管理
            </button>
          )}
          <button onClick={() => setActiveTab('security')} className={`flex-1 py-4 text-center font-medium min-w-[120px] whitespace-nowrap px-4 ${activeTab === 'security' ? 'bg-brand-50 text-brand-700 border-b-2 border-brand-600' : 'text-gray-600 hover:bg-gray-50'}`}>
            设置
          </button>
        </div>

        <div className="p-4 sm:p-6">
          {/* APPEAL MANAGEMENT */}
          {activeTab === 'appeals' && (
            <div>
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <h3 className="text-lg font-bold text-gray-800">工单管理</h3>
                <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                   <div className="relative flex-1 sm:flex-none">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                     <input type="text" placeholder="搜邮箱/用户名..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full sm:w-48 pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
                   </div>
                   <div className="relative flex-1 sm:flex-none">
                     <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                     <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full sm:w-36 pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none appearance-none bg-white">
                       <option value="ALL">全部状态</option>
                       <option value={AppealStatus.PENDING}>待处理</option>
                       <option value={AppealStatus.PROCESSING}>处理中</option>
                       <option value={AppealStatus.FOLLOW_UP}>跟进中</option>
                       <option value={AppealStatus.PASSED}>申诉通过</option>
                       <option value={AppealStatus.REJECTED}>申诉驳回</option>
                     </select>
                   </div>
                   <button onClick={handleExportCSV} className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium transition-colors shadow-sm">
                     <FileSpreadsheet size={16} /> 导出
                   </button>
                </div>
              </div>

              {/* Responsive List/Table */}
              <div className="block md:hidden space-y-4">
                {filteredAppeals.map(appeal => (
                    <div key={appeal.id} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                      <div className="flex justify-between items-start mb-2">
                        <div><span className="font-bold text-gray-900">{appeal.accountType}</span><span className="text-gray-500 text-xs ml-2">{new Date(appeal.createdAt).toLocaleDateString()}</span></div>
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${appeal.status === AppealStatus.PASSED ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>{appeal.status}</span>
                      </div>
                      <button onClick={() => handleEditClick(appeal)} className="w-full py-2 bg-brand-50 text-brand-700 rounded-lg font-medium text-sm flex items-center justify-center gap-2 mt-2"><Edit3 size={16} /> 处理工单</button>
                    </div>
                  ))}
              </div>
              <div className="hidden md:block overflow-x-auto border border-gray-200 rounded-lg">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">提交时间</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">客户</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">账号类型</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">店铺邮箱</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">当前状态</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredAppeals.map(appeal => (
                        <tr key={appeal.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-sm text-gray-500">{new Date(appeal.createdAt).toLocaleDateString()}</td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{appeal.username}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{appeal.accountType}</td>
                          <td className="px-4 py-3 text-sm text-gray-500 max-w-[150px] truncate" title={appeal.emailAccount}>{appeal.emailAccount}</td>
                          <td className="px-4 py-3 text-sm">
                             <span className={`px-2 py-1 rounded-full text-xs font-semibold ${appeal.status === AppealStatus.PASSED ? 'bg-green-100 text-green-700' : appeal.status === AppealStatus.REJECTED ? 'bg-red-100 text-red-700' : appeal.status === AppealStatus.PROCESSING ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                             {appeal.status === AppealStatus.FOLLOW_UP && appeal.statusDetail ? appeal.statusDetail : appeal.status}
                           </span>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <button onClick={() => handleEditClick(appeal)} className="text-brand-600 hover:text-brand-900 font-medium flex items-center gap-1"><Edit3 size={16} /> 处理</button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* FINANCE & USERS & SECURITY TABS REMAIN SIMILAR */}
          {activeTab === 'finance' && (
             <div>
               <h3 className="text-lg font-bold text-gray-800 mb-4">财务审核</h3>
               <div className="space-y-4">{transactions.filter(t => t.type === TransactionType.RECHARGE && t.status === TransactionStatus.PENDING).map(tx => (
                 <div key={tx.id} className="border border-blue-200 rounded-lg p-4 flex justify-between items-center bg-blue-50">
                    <div><p className="font-bold">{tx.username} 充值 ¥{tx.amount}</p><p className="text-xs text-gray-500">{new Date(tx.createdAt).toLocaleString()}</p></div>
                    <div className="flex gap-2"><button onClick={() => handleRejectRecharge(tx)} className="px-3 py-1 bg-white text-red-600 border border-red-200 rounded">拒绝</button><button onClick={() => handleApproveRecharge(tx)} className="px-3 py-1 bg-green-600 text-white rounded">确认</button></div>
                 </div>
               ))}</div>
               {/* Transaction History Table */}
               <div className="mt-8 border-t pt-4"><h4 className="font-bold text-gray-600 mb-2">流水记录</h4>
               <table className="min-w-full text-sm"><thead><tr className="bg-gray-50"><th className="p-2 text-left">用户</th><th className="p-2 text-left">类型</th><th className="p-2 text-left">金额</th><th className="p-2 text-left">状态</th></tr></thead><tbody>
                 {transactions.slice(0, 10).map(t => <tr key={t.id} className="border-t"><td className="p-2">{t.username}</td><td className="p-2">{t.type}</td><td className={`p-2 font-bold ${t.type===TransactionType.RECHARGE?'text-green-600':'text-red-600'}`}>{t.amount}</td><td className="p-2">{t.status}</td></tr>)}
               </tbody></table></div>
             </div>
          )}
          
          {/* USERS TAB */}
          {activeTab === 'users' && isSuperAdmin && (
             <div>
               <h3 className="text-lg font-bold text-gray-800 mb-4">用户管理</h3>
               <table className="min-w-full text-sm border"><thead><tr className="bg-gray-50"><th className="p-2">用户</th><th className="p-2">余额</th><th className="p-2">角色</th><th className="p-2">操作</th></tr></thead>
               <tbody>{allUsers.map(u => <tr key={u.id} className="border-t"><td className="p-2">{u.username}</td><td className="p-2">¥{u.balance}</td><td className="p-2">{u.role}</td><td className="p-2"><button onClick={() => setEditingUser(u)} className="text-blue-600">编辑</button></td></tr>)}</tbody></table>
             </div>
          )}

          {/* SECURITY TAB */}
          {activeTab === 'security' && (
             <div className="space-y-6">
               <div>
                  <h3 className="text-lg font-bold text-gray-800 mb-4">系统设置</h3>
                  
                  {/* API Key Status Check */}
                  <div className={`p-4 rounded-lg border mb-6 transition-all ${isApiKeyConfigured ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <h4 className="font-bold flex items-center gap-2 text-gray-800">
                      {isApiKeyConfigured ? <CheckCircle className="text-green-600"/> : <XCircle className="text-red-600"/>}
                      AI 功能配置状态
                    </h4>
                    <p className={`text-sm mt-1 font-medium ${isApiKeyConfigured ? 'text-green-700' : 'text-red-700'}`}>
                      {isApiKeyConfigured 
                        ? 'API Key 已成功加载。AI 智能撰写功能已就绪（Gemini 2.0 Flash）。' 
                        : '未检测到 API Key。AI 功能无法使用。'}
                    </p>
                    
                    {!isApiKeyConfigured && (
                      <div className="mt-3 bg-white p-4 rounded border border-gray-100 shadow-sm space-y-3">
                        <div>
                            <p className="font-bold mb-1 text-red-600 text-sm">问题原因：</p>
                            <p className="text-sm">Netlify 的环境变量中缺少 API_KEY 配置，或者配置后未重新部署。</p>
                        </div>
                        
                        <div className="pt-2 border-t border-gray-100">
                            <h4 className="font-bold text-brand-600 text-sm flex items-center gap-1 mb-2">
                               <Settings size={16}/> 修复步骤 (请按顺序操作)：
                            </h4>
                            <div className="bg-gray-50 text-gray-700 p-3 rounded text-sm space-y-2 border border-gray-200">
                              <p>1. 登录 Netlify 后台，进入 <b>Site configuration</b> &gt; <b>Environment variables</b>。</p>
                              <p>2. 点击 <b>Add a variable</b>。</p>
                              <p>3. Key (键名) 填写: <code className="bg-gray-200 px-1 rounded font-bold">API_KEY</code></p>
                              <p>4. Value (键值) 填写: 您的以 <code className="bg-gray-200 px-1 rounded">AIza...</code> 开头的 Google Gemini 密钥。</p>
                              <p>5. <b>关键步骤：</b> 保存后，必须去 <b>Deploys</b> 页面点击 <b>"Trigger deploy"</b> -> <b>"Clear cache and deploy site"</b>。</p>
                              <p className="text-xs text-gray-500 mt-2 pt-2 border-t">提示：Vite 项目的环境变量是在构建时注入的，因此修改配置后必须重新构建部署才能生效。</p>
                            </div>
                        </div>
                      </div>
                    )}
                  </div>

               </div>
             </div>
          )}

          {/* --- V2 BRAIN / KNOWLEDGE BASE TAB --- */}
          {activeTab === 'brain' && isSuperAdmin && (
            <div className="space-y-6">
              <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-6 text-white shadow-lg">
                <h2 className="text-2xl font-bold flex items-center gap-3"><BrainCircuit size={32}/> AI 智囊团 (Pro 版)</h2>
                <p className="mt-2 opacity-90">在这里录入成功的申诉案例 (POA)。系统会自动学习这些案例的写作风格和逻辑，在生成新 POA 时进行“检索增强 (RAG)”。</p>
                <div className="mt-4 flex gap-4 text-sm font-medium">
                   <div className="bg-white/20 px-3 py-1 rounded">当前收录: {knowledgeBase.length} 篇</div>
                   <div className="bg-white/20 px-3 py-1 rounded">累计调用: {knowledgeBase.reduce((acc, i) => acc + i.usageCount, 0)} 次</div>
                </div>
              </div>

              {/* Add New Case */}
              <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                 <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><BookOpen size={20}/> 录入成功案例</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">申诉大类</label>
                      <select value={kbType} onChange={e => setKbType(e.target.value as PoaType)} className="w-full border p-2 rounded">
                        {Object.values(PoaType).map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">具体细分</label>
                      <select value={kbSubType} onChange={e => setKbSubType(e.target.value)} className="w-full border p-2 rounded">
                        {POA_TYPE_MAPPING[kbType].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                 </div>
                 <div className="mb-4">
                   <label className="block text-sm font-medium text-gray-700 mb-1">案例标题 (批量上传时自动使用文件名)</label>
                   <input type="text" value={kbTitle} onChange={e => setKbTitle(e.target.value)} placeholder="单个录入时填写，如：OTD过低申诉成功模板" className="w-full border p-2 rounded" />
                 </div>
                 
                 {/* FILE UPLOAD FOR KB */}
                 <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex justify-between">
                      <span>POA 内容来源</span>
                      <span className="text-xs text-indigo-600 font-normal">支持拖拽多个 .docx 文件进行批量导入 (自动识别类型+智能查重)</span>
                    </label>
                    <div className="border border-gray-300 rounded-lg p-4 mb-2 bg-gray-50 flex flex-col items-center gap-3 border-dashed hover:bg-gray-100 transition-colors relative">
                       {kbFileUploading ? (
                          <div className="flex flex-col items-center w-full">
                             <div className="flex items-center gap-2 mb-2">
                               <Loader2 className="animate-spin text-indigo-600" size={24}/>
                               <p className="text-sm text-gray-600 font-medium">正在智能解析并入库...</p>
                             </div>
                             {/* UPLOAD LOGS */}
                             <div className="w-full max-h-40 overflow-y-auto bg-black/5 rounded p-2 text-xs font-mono text-gray-600 space-y-1">
                                {kbUploadLogs.map((log, idx) => <div key={idx}>{log}</div>)}
                             </div>
                          </div>
                       ) : (
                          <>
                            <FilePlus className="text-gray-400" size={32} />
                            <p className="text-sm text-gray-500">点击选择或拖拽多个 .docx 文件至此</p>
                            <input 
                              type="file" 
                              accept=".docx" 
                              multiple
                              onChange={handleKbFileUpload} 
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                          </>
                       )}
                    </div>

                    <textarea value={kbContent} onChange={e => setKbContent(e.target.value)} rows={6} placeholder="或者直接在此粘贴 POA 文本内容..." className="w-full border p-2 rounded font-mono text-sm" />
                 </div>
                 <button onClick={handleAddKbItem} disabled={kbFileUploading} className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:bg-gray-400">保存至知识库</button>
              </div>

              {/* List Cases (Collapsible Groups) */}
              <div className="space-y-4">
                {Object.values(PoaType).map(groupType => {
                   const groupItems = knowledgeBase.filter(k => k.type === groupType);
                   if (groupItems.length === 0) return null;

                   const isExpanded = expandedKbGroups[groupType];

                   return (
                     <div key={groupType} className="border border-gray-200 rounded-lg bg-white overflow-hidden shadow-sm">
                        <button 
                          onClick={() => toggleKbGroup(groupType)}
                          className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                        >
                           <div className="flex items-center gap-2 font-bold text-gray-800">
                              <Layers size={18} className="text-indigo-600" />
                              {groupType}
                              <span className="bg-gray-200 text-gray-600 text-xs px-2 py-0.5 rounded-full">{groupItems.length}</span>
                           </div>
                           {isExpanded ? <ChevronDown size={20} className="text-gray-400"/> : <ChevronRight size={20} className="text-gray-400"/>}
                        </button>
                        
                        {isExpanded && (
                          <div className="divide-y divide-gray-100">
                             {groupItems.map(item => (
                                <div key={item.id} className="p-4 flex justify-between items-start hover:bg-gray-50 group transition-colors">
                                    <div>
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] rounded font-bold border border-indigo-100">{item.subType}</span>
                                        <h4 className="font-bold text-gray-700 text-sm">{item.title}</h4>
                                      </div>
                                      <p className="text-gray-400 text-xs line-clamp-1">{item.content.substring(0, 100)}...</p>
                                    </div>
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); handleDeleteKb(item.id); }} 
                                      className="text-gray-300 hover:text-red-500 p-2 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                      title="删除此案例"
                                    >
                                      <Trash2 size={16}/>
                                    </button>
                                </div>
                             ))}
                          </div>
                        )}
                     </div>
                   );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* V2 UPGRADED EDIT APPEAL MODAL */}
      {editingAppeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[95vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 shrink-0">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                 工单处理: {editingAppeal.id} 
                 <span className="text-sm font-normal text-gray-500">({editingAppeal.username})</span>
              </h3>
              <button onClick={() => setEditingAppeal(null)} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
              </button>
            </div>
            
            <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
              {/* LEFT COLUMN: Info & Status (Scrollable) */}
              <div className="w-full md:w-1/3 p-6 border-r border-gray-200 overflow-y-auto bg-gray-50/50">
                  <h4 className="font-bold text-gray-700 mb-4 border-b pb-2">基础信息</h4>
                  <div className="space-y-3 text-sm text-gray-700 mb-6">
                    <p><span className="font-semibold">账号类型:</span> {editingAppeal.accountType}</p>
                    <p><span className="font-semibold">邮箱:</span> {editingAppeal.emailAccount}</p>
                    <p><span className="font-semibold">密码:</span> {editingAppeal.emailPass}</p>
                    <div className="bg-white p-3 rounded border border-gray-200">
                       <span className="font-semibold text-gray-900 block mb-1">环境/登录:</span>
                       <p className="whitespace-pre-wrap text-xs">{editingAppeal.loginInfo}</p>
                    </div>
                    {editingAppeal.description && (
                      <div className="bg-white p-3 rounded border border-gray-200">
                         <span className="font-semibold text-gray-900 block mb-1">客户描述:</span>
                         <p className="whitespace-pre-wrap text-xs">{editingAppeal.description}</p>
                      </div>
                    )}
                    {editingAppeal.screenshot && renderAttachment(editingAppeal.screenshot)}
                  </div>

                  <h4 className="font-bold text-gray-700 mb-4 border-b pb-2">状态更新</h4>
                  <div className="space-y-4">
                    <div>
                       <label className="block text-xs font-bold text-gray-500 mb-1">当前状态</label>
                       <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as AppealStatus)} className="w-full px-3 py-2 border rounded shadow-sm">
                         <option value={AppealStatus.PROCESSING}>处理中</option>
                         <option value={AppealStatus.FOLLOW_UP}>跟进中</option>
                         <option value={AppealStatus.PASSED}>申诉通过</option>
                         <option value={AppealStatus.REJECTED}>申诉驳回</option>
                       </select>
                    </div>
                    {editStatus === AppealStatus.PASSED && (
                       <div className="bg-green-50 p-3 rounded border border-green-100">
                         <label className="block text-xs font-bold text-green-800 mb-1">扣费金额 (¥)</label>
                         <input type="number" value={editDeduction} onChange={(e) => setEditDeduction(parseFloat(e.target.value))} className="w-full px-2 py-1 border rounded" />
                       </div>
                    )}
                    <div>
                       <label className="block text-xs font-bold text-gray-500 mb-1">给客户的备注</label>
                       <textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} rows={3} className="w-full px-3 py-2 border rounded text-sm" placeholder="例如：资料已提交，等待审核..." />
                    </div>
                  </div>
              </div>

              {/* RIGHT COLUMN: AI Smart Writer (Scrollable) */}
              <div className="w-full md:w-2/3 p-6 overflow-y-auto bg-white">
                  <div className="flex justify-between items-center mb-6">
                    <h4 className="font-bold text-indigo-700 flex items-center gap-2 text-lg">
                      <Sparkles size={20} /> 智能 POA 撰写器
                    </h4>
                    <span className="text-xs text-indigo-400 border border-indigo-100 bg-indigo-50 px-2 py-1 rounded">V2 AI Brain Enabled</span>
                  </div>

                  {/* Step 1: Inputs */}
                  {aiStep === 1 && (
                    <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
                       <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">申诉大类 (后果)</label>
                            <select value={aiPoaType} onChange={e => setAiPoaType(e.target.value as PoaType)} className="w-full border p-2 rounded focus:ring-2 ring-indigo-200 outline-none">
                              {Object.values(PoaType).map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">具体原因/场景</label>
                            <select value={aiPoaSubType} onChange={e => setAiPoaSubType(e.target.value)} className="w-full border p-2 rounded focus:ring-2 ring-indigo-200 outline-none">
                              {POA_TYPE_MAPPING[aiPoaType].map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                       </div>

                       {(aiPoaSubType.includes('知识产权') || aiPoaSubType.includes('侵权')) && (
                          <div className="bg-yellow-50 border border-yellow-200 p-3 rounded text-sm text-yellow-800 flex items-start gap-2">
                             <AlertTriangle size={16} className="mt-0.5 shrink-0"/>
                             <div>
                               <p className="font-bold">侵权申诉前置检查：</p>
                               <ul className="list-disc pl-4 mt-1 space-y-1">
                                 <li>是否已删除账户内所有侵权 ASIN？</li>
                                 <li>是否已检查并下架类似风险产品？</li>
                               </ul>
                             </div>
                          </div>
                       )}

                       {/* NEW: ESSENTIAL DETAILS */}
                       <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                              <Store size={14} className="text-gray-400"/> 店铺名称 (Store Name)
                            </label>
                            <input 
                              type="text" 
                              value={aiStoreName} 
                              onChange={e => setAiStoreName(e.target.value)} 
                              className="w-full border p-2 rounded text-sm focus:ring-2 ring-indigo-200 outline-none" 
                              placeholder="例如：SuperDeals LLC"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                              <Hash size={14} className="text-gray-400"/> Partner ID (PID)
                            </label>
                            <input 
                              type="text" 
                              value={aiPartnerId} 
                              onChange={e => setAiPartnerId(e.target.value)} 
                              className="w-full border p-2 rounded text-sm focus:ring-2 ring-indigo-200 outline-none" 
                              placeholder="例如：100012345"
                            />
                          </div>
                       </div>
                       
                       <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                              <Calendar size={14} className="text-gray-400"/> 封号/发生时间
                            </label>
                            <input 
                              type="date" 
                              value={aiDate} 
                              onChange={e => setAiDate(e.target.value)} 
                              className="w-full border p-2 rounded text-sm focus:ring-2 ring-indigo-200 outline-none" 
                            />
                          </div>
                          
                          {/* DYNAMIC FIELDS: Performance Metrics */}
                          {(aiPoaSubType.includes('OTD') || aiPoaSubType.includes('VTR') || aiPoaSubType.includes('率')) && (
                             <div className="grid grid-cols-2 gap-2">
                               <div>
                                 <label className="block text-sm font-medium text-gray-700 mb-1">当前指标 (Current)</label>
                                 <input 
                                    type="text"
                                    value={aiMetricCurrent}
                                    onChange={e => setAiMetricCurrent(e.target.value)}
                                    className="w-full border p-2 rounded focus:ring-2 ring-indigo-200 outline-none text-sm"
                                    placeholder="e.g. 90.8%"
                                 />
                               </div>
                               <div>
                                 <label className="block text-sm font-medium text-gray-700 mb-1">目标指标 (Target)</label>
                                 <input 
                                    type="text"
                                    value={aiMetricTarget}
                                    onChange={e => setAiMetricTarget(e.target.value)}
                                    className="w-full border p-2 rounded focus:ring-2 ring-indigo-200 outline-none text-sm"
                                    placeholder="e.g. 99%"
                                 />
                               </div>
                             </div>
                          )}

                          {/* DYNAMIC FIELDS: IP / Others */}
                          {!(aiPoaSubType.includes('OTD') || aiPoaSubType.includes('VTR') || aiPoaSubType.includes('率')) && (
                             <div>
                               <label className="block text-sm font-medium text-gray-700 mb-1">关联 ASIN / 订单号 (选填)</label>
                               <input 
                                   type="text"
                                   value={aiRootCause} // Reusing root cause state as generic ID holder if needed, or better use aiTableExtract
                                   onChange={e => setAiRootCause(e.target.value)} // Keep using generic text
                                   className="w-full border p-2 rounded focus:ring-2 ring-indigo-200 outline-none text-sm"
                                   placeholder="Order ID / ASIN"
                               />
                             </div>
                          )}
                       </div>

                       {/* DATA EXTRACTION FIELD - KEY FEATURE FOR TABLE INTEGRATION */}
                       <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 relative group">
                          <label className="block text-sm font-bold text-gray-800 mb-1 flex items-center gap-2">
                             <Table size={16} className="text-brand-600"/> 表格数据提取 (Table Data Extract)
                          </label>
                          <p className="text-xs text-gray-500 mb-2">
                            可以直接粘贴数据，或<span className="text-brand-600 font-bold">上传 Excel 文件</span>让 AI 自动分析。
                            <span className="text-red-500 font-bold ml-1">AI 将自动识别多个 Tab（如 Late Shipment, Carrier Delays）。</span>
                          </p>
                          
                          <div className="absolute top-3 right-3 flex gap-2">
                             {/* EXCEL UPLOAD BUTTON */}
                             <div className="relative overflow-hidden cursor-pointer bg-green-50 hover:bg-green-100 text-green-700 px-3 py-1 rounded text-xs font-bold border border-green-200 flex items-center gap-1 transition-colors shadow-sm">
                               {isAnalyzingExcel ? <Loader2 size={12} className="animate-spin"/> : <FileSpreadsheet size={14}/>}
                               {isAnalyzingExcel ? '分析中...' : '上传 Excel 分析'}
                               <input 
                                 type="file" 
                                 accept=".xlsx, .xls"
                                 onChange={handleAnalyzeExcel}
                                 className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                               />
                             </div>
                          </div>

                          <textarea 
                             value={aiTableExtract} 
                             onChange={e => setAiTableExtract(e.target.value)}
                             rows={4} 
                             className="w-full border p-2 rounded focus:ring-2 ring-brand-200 outline-none text-sm font-mono bg-white"
                             placeholder={`AI 分析结果将显示在此处。例如：\n====== TAB: Late Shipment ======\nOrder 123...`}
                          />
                       </div>

                       <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">根本原因分析 (Root Cause Analysis)</label>
                          <textarea 
                             value={aiRootCause} 
                             onChange={e => setAiRootCause(e.target.value)}
                             rows={3} 
                             className="w-full border p-3 rounded focus:ring-2 ring-indigo-200 outline-none text-sm"
                             placeholder="简述原因逻辑，例如：仓库人手不足导致漏扫，结合上方数据使用..."
                          />
                       </div>

                       {/* NEW: CUSTOM INSTRUCTIONS FOR TUNING */}
                       <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-100">
                          <label className="block text-sm font-bold text-indigo-700 mb-1 flex items-center gap-1">
                             <MessageSquarePlus size={14}/> 质量调校 / 额外指令 (Custom Instructions)
                          </label>
                          <textarea 
                             value={aiCustomInstructions}
                             onChange={e => setAiCustomInstructions(e.target.value)}
                             rows={2}
                             className="w-full border p-2 rounded text-sm focus:ring-2 ring-indigo-200 outline-none bg-white"
                             placeholder="例如：语气要更强硬一点；请强调我们已经开除了涉事员工；篇幅控制在 500 词以内..."
                          />
                       </div>

                       <div className="pt-2">
                          <button 
                            onClick={generateSmartPOA}
                            disabled={isGeneratingPoa}
                            className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
                          >
                             {isGeneratingPoa ? <Loader2 className="animate-spin" /> : <Sparkles />} 
                             {isGeneratingPoa ? '正在深度思考并撰写...' : '开始智能撰写 (Generate POA)'}
                          </button>
                       </div>
                    </div>
                  )}

                  {/* Step 2: Result */}
                  {aiStep === 2 && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 h-full flex flex-col">
                       {/* RAG References Display */}
                       {ragReferences.length > 0 && (
                          <div className="bg-indigo-50 border-l-4 border-indigo-500 p-3 rounded-r text-xs text-indigo-700">
                             <p className="font-bold flex items-center gap-1"><BookOpen size={14}/> 系统已自动参考以下成功案例进行生成：</p>
                             <ul className="list-disc pl-4 mt-1 opacity-80">
                               {ragReferences.map((ref, i) => <li key={i}>{ref}</li>)}
                             </ul>
                          </div>
                       )}

                       <div className="flex justify-between items-center">
                          <button onClick={() => setAiStep(1)} className="text-sm text-gray-500 hover:text-gray-700 underline">返回修改参数</button>
                          
                          <div className="flex items-center gap-2">
                             <button 
                                onClick={handleDownloadDoc}
                                className="flex items-center gap-1 text-sm bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 px-3 py-1 rounded transition-colors"
                             >
                               <FileText size={14}/> 下载 Word
                             </button>
                             <button 
                               onClick={() => {
                                 navigator.clipboard.writeText(aiGeneratedText);
                                 showToast('已复制到剪贴板', 'success');
                               }}
                               className="flex items-center gap-1 text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded text-gray-700 transition-colors"
                             >
                               <Copy size={14}/> 复制全文
                             </button>
                          </div>
                       </div>
                       
                       <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg p-4 overflow-y-auto font-mono text-sm leading-relaxed whitespace-pre-wrap">
                          {aiGeneratedText}
                       </div>

                       <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-100 text-xs text-indigo-800">
                          <p className="font-bold flex items-center gap-1"><BrainCircuit size={14}/> 自动学习机制：</p>
                          <p>如果您采用了此文案并在左侧将状态改为“申诉通过”，系统将提示您将其存入知识库。</p>
                       </div>
                    </div>
                  )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3 shrink-0">
              <button onClick={() => setEditingAppeal(null)} className="px-6 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 font-medium">取消</button>
              <button onClick={handleSaveAppeal} disabled={loading} className="px-6 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium flex items-center gap-2">
                {loading ? <Clock className="animate-spin" size={18}/> : <Save size={18} />} 保存更新
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT USER MODAL */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center"><h3 className="text-lg font-bold text-gray-900">编辑用户</h3><button onClick={() => setEditingUser(null)} className="text-gray-400 hover:text-gray-600"><X size={24} /></button></div>
            <div className="p-6 space-y-4">
              <div><label className="block text-sm font-medium mb-1">用户名</label><input type="text" disabled value={editingUser.username} className="w-full p-2 bg-gray-100 rounded" /></div>
              <div><label className="block text-sm font-medium mb-1">余额</label><input type="number" value={editingUser.balance} onChange={(e) => setEditingUser({...editingUser, balance: parseFloat(e.target.value)})} className="w-full p-2 border rounded" /></div>
              <div><label className="block text-sm font-medium mb-1">角色</label><select value={editingUser.role} onChange={(e) => setEditingUser({...editingUser, role: e.target.value as UserRole})} className="w-full p-2 border rounded"><option value={UserRole.CLIENT}>客户</option><option value={UserRole.ADMIN}>管理员</option><option value={UserRole.SUPER_ADMIN}>老板</option></select></div>
            </div>
             <div className="p-6 bg-gray-50 flex justify-end gap-3"><button onClick={() => setEditingUser(null)} className="px-4 py-2 text-gray-600">取消</button><button onClick={handleSaveUser} className="px-4 py-2 bg-brand-600 text-white rounded">保存</button></div>
          </div>
        </div>
      )}

      {/* LIGHTBOX */}
      {lightboxUrl && (
         <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
            <button className="absolute top-4 right-4 text-white/80 hover:text-white p-2" onClick={() => setLightboxUrl(null)}><X size={32} /></button>
            <img src={lightboxUrl} alt="Preview" className="max-w-full max-h-[90vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
         </div>
      )}
    </div>
  );
};