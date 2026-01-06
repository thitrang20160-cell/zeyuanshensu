
export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN', // 老板/超级管理员
  ADMIN = 'ADMIN',             // 普通管理员
  CLIENT = 'CLIENT',           // 客户
}

export enum AppealStatus {
  PENDING = '待处理',
  PROCESSING = '处理中',
  FOLLOW_UP = '跟进中', // Dynamic date will be added to notes
  PASSED = '申诉通过',
  REJECTED = '申诉驳回',
}

export enum TransactionType {
  RECHARGE = '充值',
  DEDUCTION = '扣费',
}

export enum TransactionStatus {
  PENDING = '待审核',
  APPROVED = '已入账',
  REJECTED = '已拒绝',
}

export interface User {
  id: string;
  username: string;
  // password field removed. Passwords are managed by Supabase Auth strictly.
  phone?: string;    // Added for phone binding UI
  role: UserRole;
  balance: number;
  createdAt: string;
}

export interface Appeal {
  id: string;
  userId: string;
  username: string; // Denormalized for easier display
  accountType: string; // PurpleBird, VPS, etc.
  loginInfo: string;
  emailAccount: string;
  emailPass: string;
  description?: string; // New field: Situation description
  screenshot?: string; // Base64 data
  status: AppealStatus;
  statusDetail?: string; // e.g., "12月23日已跟进"
  adminNotes: string;
  deductionAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  userId: string;
  username: string;
  type: TransactionType;
  amount: number;
  status: TransactionStatus;
  note?: string; // e.g. "Recharge for Order 123"
  createdAt: string;
}

// System Configuration stored in JSON
export interface SystemConfig {
  contactInfo: string; // Admin contact details
  paymentQrUrl?: string; // Dynamic URL for the QR code
  
  // Marketing / Social Proof Configuration
  marketingBaseCases?: number;       // e.g. 3500 (Base number added to real count)
  marketingSuccessRate?: string;     // e.g. "98.5" (Displayed if real data is insufficient)
  marketingBaseProcessing?: number;  // e.g. 15 (Base number added to real queue)
}

// --- V2 AI Knowledge Base Types ---

// 重构：按申诉后果分类，而非原因分类
export enum PoaType {
  ACCOUNT_SUSPENSION = '店铺账户暂停 (Account Suspension)',
  FULFILLMENT_SUSPENSION = '自发货权限暂停 (Fulfillment Suspension)',
  OTHER = '其他问题'
}

// Mapping relationship for UI
export const POA_TYPE_MAPPING: Record<PoaType, string[]> = {
  [PoaType.ACCOUNT_SUSPENSION]: [
    // 绩效问题导致的封店 (长文)
    'OTD (发货及时率低) - 导致封店',
    'VTR (物流追踪率低) - 导致封店',
    '取消率过高 - 导致封店',
    '退款率过高 - 导致封店',
    // 政策违规导致的封店
    '知识产权 - 商标侵权 (Trademark)',
    '知识产权 - 版权侵权 (Copyright)',
    '知识产权 - 专利侵权 (Patent)',
    '知识产权 - 假冒商品 (Counterfeit)',
    '操控评论 (Review Manipulation)',
    '客户欺诈投诉 (Customer Fraud Complaint)',
    '二审/身份验证 (Identity Verification)',
    '违反销售政策 (Prohibited Items)',
    '关联账户 (Related Accounts)',
    '其他 - 导致封店'
  ],
  [PoaType.FULFILLMENT_SUSPENSION]: [
    // 自发货权限暂停 (必须限制 1000 字符)
    'OTD (发货及时率低) - 暂停自发货',
    'VTR (物流追踪率低) - 暂停自发货',
    '取消率过高 - 暂停自发货'
  ],
  [PoaType.OTHER]: [
    '退货地址验证',
    '资金冻结申诉',
    '其他非账号问题'
  ]
};

export interface KnowledgeBaseItem {
  id: string;
  type: PoaType;
  subType: string; // Values from POA_TYPE_MAPPING lists
  title: string; // e.g., "2024-05 Successful OTD Appeal"
  content: string; // The full POA text
  tags?: string[];
  createdAt: string;
  usageCount: number; // For ranking
}

export const INITIAL_ADMIN: User = {
  id: 'admin-001',
  username: 'admin',
  role: UserRole.ADMIN,
  balance: 0,
  createdAt: new Date().toISOString(),
};