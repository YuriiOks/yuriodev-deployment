/**
 * About Data - Personal Information & Mission
 * Updated from CV (October 2025)
 */

export interface Achievement {
  metric: string;
  label: string;
  description?: string;
}

export interface AboutData {
  headline: string;
  yearsExperience: string;
  summary: string;
  mission: string;
  currentlyBuilding: string[];
  nextSteps: string[];
  vision: string[];
  achievements: Achievement[];
  contact: {
    email: string;
    phone: string;
    location: string;
    linkedin: string;
    x: string;
    github: string;
  };
}

export const aboutData: AboutData = {
  headline: "AI/ML Systems Engineer | Agentic Architect",
  yearsExperience: "8+",
  summary: `Specialized in building production-grade AI/ML systems with focus on agentic architectures, RAG pipelines, and cloud-native platforms. Currently architecting intelligent agents and democratizing ML education through hands-on learning.`,
  
  mission: `Building the next generation of AI education — moving beyond theory to production-ready skills. Creating open-source resources and learning platforms that bridge the gap between knowing and doing.`,
  
  currentlyBuilding: [
    "YuriODev Platform",
    "MCP Server Architecture",
    "Multi-Agent Workflows",
    "RAG Pipeline Systems",
  ],
  
  nextSteps: [
    "Advanced Agentic Patterns Course",
    "Open-Source MCP Templates",
    "Production ML Playbooks",
    "Community Workshops & Mentoring",
  ],
  
  vision: [
    "Democratize AI/ML education",
    "Production-first learning",
    "Global developer community",
    "Open knowledge sharing",
  ],
  
  achievements: [
    {
      metric: "×50",
      label: "Data Latency Reduction",
      description: "Optimized BigQuery pipeline for property valuation platform",
    },
    {
      metric: "200%",
      label: "Sales Conversion Increase",
      description: "Multi-agent sales automation platform (SaleSphereAI)",
    },
    {
      metric: "1000+",
      label: "Students Reached",
      description: "Through YuriODev educational initiatives",
    },
  ],
  
  contact: {
    email: "yurii.oksamytnyi@yuriodev.co.uk",
    phone: "+44 7767 336011",
    location: "London, UK",
    linkedin: "https://linkedin.com/in/y-oks",
    x: "https://x.com/YuriODev",
    github: "https://github.com/YuriiOks",
  },
};
