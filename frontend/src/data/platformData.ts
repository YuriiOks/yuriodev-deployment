/**
 * Platform Data - YuriODev Educational Initiative
 * Updated from CV (October 2025)
 */

import { PROJECT_LINKS } from './site';

export interface RoadmapPhase {
  phase: number;
  title: string;
  status: 'completed' | 'active' | 'planned';
  description: string;
  completionDate?: string;
}

export interface PlatformFeature {
  title: string;
  description: string;
  icon: string;
  link?: string;
  status: 'live' | 'beta' | 'coming-soon';
}

export interface PlatformData {
  name: string;
  tagline: string;
  mission: string;
  currentPhase: {
    phase: number;
    title: string;
    progress: number;
  };
  roadmap: RoadmapPhase[];
  features: PlatformFeature[];
  stats: {
    label: string;
    value: string;
  }[];
}

export const platformData: PlatformData = {
  name: "YuriODev",
  tagline: "Democratizing AI/ML Education",
  mission: "Bridge the gap between theoretical ML knowledge and practical production systems through hands-on learning, automated feedback, and real-world projects.",
  
  currentPhase: {
    phase: 2,
    title: "Content Creation & Community Building",
    progress: 65,
  },
  
  roadmap: [
    {
      phase: 1,
      title: "Foundation & Infrastructure",
      status: "completed",
      description: "Built core platform infrastructure, CI/CD pipelines, and automated grading systems",
      completionDate: "Dec 2023",
    },
    {
      phase: 2,
      title: "Content Creation & Community",
      status: "active",
      description: "Developing comprehensive courses, video tutorials, and building learner community",
    },
    {
      phase: 3,
      title: "Interactive Platform Launch",
      status: "planned",
      description: "Full-stack web platform with code sandboxes, progress tracking, and live collaboration",
    },
    {
      phase: 4,
      title: "AI-Powered Features",
      status: "planned",
      description: "Intelligent tutoring system, personalized learning paths, and automated mentoring",
    },
  ],
  
  features: [
    {
      title: "Comprehensive Python Course",
      description: "25+ modules covering AQA GCSE CS syllabus from fundamentals to OOP with automated testing",
      icon: "🐍",
      link: PROJECT_LINKS.pythonCourse,
      status: "live",
    },
    {
      title: "Automated CI/CD Grading",
      description: "GitHub Actions-powered testing workflow providing instant feedback on student submissions",
      icon: "🔄",
      link: PROJECT_LINKS.pythonCourse,
      status: "live",
    },
    {
      title: "Video Tutorials",
      description: "Step-by-step YouTube tutorials explaining concepts with practical examples and best practices",
      icon: "🎥",
      link: "#youtube",
      status: "live",
    },
    {
      title: "Interactive Code Sandboxes",
      description: "Browser-based Python environments with real-time execution and collaborative coding",
      icon: "💻",
      status: "coming-soon",
    },
    {
      title: "ML Project Templates",
      description: "Production-ready templates for RAG systems, agent workflows, and deployment pipelines",
      icon: "🤖",
      status: "beta",
    },
    {
      title: "AI Mentor Assistant",
      description: "Intelligent tutoring system providing personalized guidance and code reviews",
      icon: "🧠",
      status: "coming-soon",
    },
  ],
  
  stats: [
    { label: "Students Reached", value: "1,000+" },
    { label: "Course Modules", value: "25+" },
    { label: "Countries", value: "20+" },
    { label: "Satisfaction Rating", value: "95%+" },
    { label: "GitHub Stars", value: "50+" },
    { label: "Video Tutorials", value: "30+" },
  ],
};
