/**
 * Timeline Data - Career Journey & Education
 * Extracted from CV (Updated: October 2025)
 */

import { PROJECT_LINKS, socialById } from './site';

export type TimelineEventType = 'experience' | 'education' | 'certification' | 'achievement';

export interface TimelineEvent {
  id: string;
  date: string;
  dateEnd?: string;
  title: string;
  company: string;
  location: string;
  type: TimelineEventType;
  description: string;
  highlights: string[];
  tags: string[];
  link?: string;
  linkText?: string;
  isOngoing?: boolean;
}

export const timelineData: TimelineEvent[] = [
  // ============================================
  // CURRENT ROLES
  // ============================================
  {
    id: 'lead-ai-engineer',
    date: 'Apr 2022',
    dateEnd: 'Present',
    title: 'Lead AI Engineer & Systems Designer',
    company: 'Independent (Consultant)',
    location: 'London, UK (Hybrid)',
    type: 'experience',
    description: 'Architecting and delivering end-to-end, production-grade AI systems for a portfolio of clients, from high-growth startups to global financial institutions. Specializing in custom agentic workflows, retrieval-augmented generation (RAG) pipelines, and the full-stack, cloud-native infrastructure required to support them.',
    highlights: [
      'Built RAG prototype improving retrieval precision from 30% to 95% with <1.2s p95 latency (100 concurrent users)',
      'Architected multi-agent sales platform (SaleSphereAI) increasing sales conversion by 200%',
      'Delivered HR Tech resume parsing platform achieving 93% F1 score and reducing time-to-hire by 75%',
      'Engineered property valuation platform processing 100M+ records with 94% accuracy and ×50 faster data loading',
      'Provided specialized consulting for JPMorgan, Bloomberg, and Houlihan Lokey on Python/R AI tooling',
    ],
    tags: ['RAG', 'LangGraph', 'MCP', 'Multi-Agent Systems', 'FastAPI', 'PyTorch', 'GCP', 'AWS'],
    isOngoing: true,
  },
  {
    id: 'technical-lead-mentor',
    date: 'Sep 2014',
    dateEnd: 'Present',
    title: 'Technical Lead & Mentor',
    company: 'YuriODev Educational Initiative',
    location: 'Remote',
    type: 'experience',
    description: 'Leading the YuriODev platform development - democratizing AI/ML education through hands-on learning. Building comprehensive programming courses with automated grading systems and interactive learning tools.',
    highlights: [
      'Created 25+ module Python course covering AQA GCSE CS syllabus with automated CI/CD grading',
      'Developed automated code review system using GitHub Actions',
      'Published educational content on YouTube reaching 1000+ learners',
      'Mentored students from beginner to professional level in Python, ML, and system design',
    ],
    tags: ['Education', 'Python', 'GitHub Actions', 'Mentoring', 'Course Design'],
    link: socialById('discord').url,
    linkText: 'Join Discord Community',
    isOngoing: true,
  },

  // ============================================
  // EXPERIENCE - CHRONOLOGICAL
  // ============================================
  {
    id: 'lead-data-scientist-moh',
    date: 'Mar 2022',
    dateEnd: 'Oct 2022',
    title: 'Lead Data Scientist (Indirect Contract)',
    company: 'Ministry of Health of Ukraine',
    location: 'Kyiv, Ukraine (Remote)',
    type: 'experience',
    description: 'Led development of national healthcare analytics platform processing millions of patient records while ensuring GDPR compliance and healthcare data privacy standards.',
    highlights: [
      'Designed and implemented ML models for patient prognosis (>90% F1 score)',
      'Built end-to-end data pipelines processing millions of patient records',
      'Engineered system for full GDPR compliance and healthcare data privacy',
      'Delivered real-time analytics dashboards for healthcare decision-making',
    ],
    tags: ['Healthcare Analytics', 'ML Models', 'GDPR', 'ETL Pipelines', 'Privacy Engineering'],
  },
  {
    id: 'senior-ml-engineer-forecys',
    date: 'Jan 2021',
    dateEnd: 'Feb 2022',
    title: 'Senior ML Engineer',
    company: 'Forecys (FinTech)',
    location: 'London, UK (Hybrid)',
    type: 'experience',
    description: 'Architected and deployed production ML systems for financial forecasting and risk analysis, handling high-volume transaction data with real-time processing requirements. Worked with Pavel Yakovlev (LinkedIn: https://www.linkedin.com/in/pavel-yakovlev/).',
    highlights: [
      'Built scalable ML pipelines for financial time-series forecasting',
      'Implemented real-time fraud detection systems processing millions of transactions',
      'Optimized model serving infrastructure reducing latency by 60%',
      'Mentored junior ML engineers on best practices and system design',
    ],
    tags: ['FinTech', 'Time Series', 'Fraud Detection', 'MLOps', 'Real-time Systems'],
  },
  {
    id: 'data-scientist-forecys',
    date: 'Apr 2019',
    dateEnd: 'Jan 2021',
    title: 'Data Scientist',
    company: 'Forecys (FinTech)',
    location: 'London, UK',
    type: 'experience',
    description: 'Developed predictive models for financial markets and implemented data-driven solutions for risk assessment and portfolio optimization.',
    highlights: [
      'Created predictive models for market trend analysis with 85%+ accuracy',
      'Built automated reporting systems reducing manual analysis time by 40%',
      'Designed ETL pipelines for multi-source financial data integration',
      'Collaborated with quant teams on algorithmic trading strategies',
    ],
    tags: ['Financial Modeling', 'Predictive Analytics', 'ETL', 'Python', 'SQL'],
  },
  {
    id: 'ios-developer',
    date: '2016',
    dateEnd: '2019',
    title: 'iOS Developer',
    company: 'Freelance',
    location: 'Remote',
    type: 'experience',
    description: 'Developed native iOS applications with focus on clean architecture, performance optimization, and user experience.',
    highlights: [
      'Built and deployed 5+ iOS apps to App Store',
      'Implemented MVC/MVVM architectures with clean code principles',
      'Integrated RESTful APIs and local data persistence',
      'Optimized app performance and memory management',
    ],
    tags: ['Swift', 'Objective-C', 'iOS', 'UIKit', 'Core Data', 'REST APIs'],
  },
  {
    id: 'mipt-instructor',
    date: 'Sep 2014',
    dateEnd: 'Jul 2016',
    title: 'Instructor - Programming & Algorithms',
    company: 'Moscow Institute of Physics and Technology (MIPT)',
    location: 'Moscow, Russia',
    type: 'experience',
    description: 'Taught undergraduate courses in programming fundamentals, data structures, and algorithm design. Developed curriculum and mentored students in competitive programming.',
    highlights: [
      'Designed and delivered courses on C++, Python, and algorithm design',
      'Mentored students for ACM ICPC competitive programming competitions',
      'Created hands-on lab assignments and automated grading systems',
      'Achieved 95%+ student satisfaction rating',
    ],
    tags: ['Teaching', 'C++', 'Python', 'Algorithms', 'Data Structures', 'Academic'],
  },

  // ============================================
  // EDUCATION & CERTIFICATIONS
  // ============================================
  {
    id: 'coursera-vertex-ai',
    date: 'Oct 2024',
    title: 'Generative AI with Vertex AI: Prompt Design',
    company: 'Google Cloud Training (Coursera)',
    location: 'Online',
    type: 'certification',
    description: 'Hands-on project covering prompt engineering with the PaLM API and text generation use cases with Google Cloud Vertex AI.',
    highlights: [
      'Mastered prompt engineering with PaLM API',
      'Explored text generation use cases',
      'Learned prompt patterns and LLM application',
      'Built practical projects with Google Cloud Platform',
    ],
    tags: ['Generative AI', 'Prompt Engineering', 'Google Cloud', 'Vertex AI', 'PaLM API'],
    link: 'https://www.coursera.org/projects/googlecloud-generative-ai-with-vertex-ai-prompt-design-hajry',
  },
  {
    id: 'coursera-math-ml',
    // date: 'Jul 2019',
    date: 'Jul 2019',
    title: 'Mathematics for Machine Learning Specialization',
    company: 'Imperial College London (Coursera)',
    location: 'Online',
    type: 'certification',
    description: 'Comprehensive specialization covering the mathematical foundations for machine learning including linear algebra, multivariate calculus, and PCA.',
    highlights: [
      'Linear Algebra: vectors, matrices, eigenvalues',
      'Multivariate Calculus: optimization and gradients',
      'Principal Component Analysis (PCA)',
      'Applied mathematics to ML algorithms in Python',
    ],
    tags: ['Mathematics', 'Linear Algebra', 'Calculus', 'Machine Learning', 'Python'],
    link: 'https://www.coursera.org/account/accomplishments/specialization/RV7U3JCUFD2A',
  },
  {
    id: 'mlx-certificate',
    date: 'Apr 2025',
    dateEnd: 'May 2025',
    title: 'MLX Applied Machine Learning Certificate',
    company: 'ML Institute',
    location: '27 Dingley Place, EC1V 8BR, London, UK',
    type: 'education',
    description: 'Intensive on-site program covering advanced ML systems, production deployment, and real-world AI applications with hands-on projects. Mentored by Besart Shyti (LinkedIn: https://www.linkedin.com/in/besart-shyti-20616956/) and Izaak Sofer (LinkedIn: https://www.linkedin.com/in/izaakrogan/).',
    highlights: [
      'Completed capstone project on agentic AI systems',
      'Implemented production-grade ML pipelines',
      'Studied advanced topics: RAG, multi-agent systems, LLM fine-tuning',
      'Collaborated with industry practitioners on real-world problems',
      'On-site intensive training in London',
    ],
    tags: ['Machine Learning', 'MLOps', 'LLMs', 'Production AI'],
    link: 'https://ml.institute/',
  },
  {
    id: 'bsc-cs',
    date: '2012',
    dateEnd: '2016',
    title: 'BSc Computer Science',
    company: 'Moscow Institute of Physics and Technology (MIPT)',
    location: 'Moscow, Russia',
    type: 'education',
    description: 'Rigorous computer science program with emphasis on theoretical foundations, algorithms, and systems programming. Participated in competitive programming and research projects.',
    highlights: [
      'Graduated with honors (GPA: 4.8/5.0)',
      'Competitive programming: Multiple ACM ICPC regional medals',
      'Research focus: Algorithms and computational complexity',
      'Teaching assistant for undergraduate programming courses',
    ],
    tags: ['Computer Science', 'Algorithms', 'Systems Programming', 'Competitive Programming', 'Academic'],
  },

  // ============================================
  // KEY ACHIEVEMENTS/MILESTONES
  // ============================================
  {
    id: 'achievement-python-course',
    date: 'Jan 2024',
    title: 'Python Course 1.0 Release',
    company: 'YuriODev',
    location: 'Remote',
    type: 'achievement',
    description: 'Launched comprehensive open-source Python course with automated grading system, reaching 1000+ students worldwide.',
    highlights: [
      'Published 25+ modules covering full GCSE CS syllabus',
      'Implemented CI/CD automated grading with GitHub Actions',
      'Released YouTube video tutorials (10+ hours content)',
      'Reached 1000+ students across 20+ countries',
    ],
    tags: ['Education', 'Open Source', 'Python', 'CI/CD'],
    link: PROJECT_LINKS.pythonCourse,
  },
];

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get events filtered by type
 */
export const getEventsByType = (type: TimelineEventType): TimelineEvent[] => {
  return timelineData.filter((event) => event.type === type);
};

/**
 * Get ongoing/current events
 */
export const getCurrentEvents = (): TimelineEvent[] => {
  return timelineData.filter((event) => event.isOngoing);
};

/**
 * Get events sorted chronologically (newest first)
 */
export const getEventsSortedByDate = (ascending = false): TimelineEvent[] => {
  return [...timelineData].sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return ascending ? dateA.getTime() - dateB.getTime() : dateB.getTime() - dateA.getTime();
  });
};

/**
 * Get events by tag
 */
export const getEventsByTag = (tag: string): TimelineEvent[] => {
  return timelineData.filter((event) => 
    event.tags.some((t) => t.toLowerCase().includes(tag.toLowerCase()))
  );
};

/**
 * Get all unique tags
 */
export const getAllTags = (): string[] => {
  const tags = new Set<string>();
  timelineData.forEach((event) => {
    event.tags.forEach((tag) => tags.add(tag));
  });
  return Array.from(tags).sort();
};

/**
 * Calculate total years of experience
 */
export const getTotalExperience = (): number => {
  const experienceEvents = getEventsByType('experience');
  const earliestDate = new Date(
    Math.min(...experienceEvents.map((e) => new Date(e.date).getTime()))
  );
  const now = new Date();
  return Math.floor((now.getTime() - earliestDate.getTime()) / (1000 * 60 * 60 * 24 * 365));
};
