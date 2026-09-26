import React, { useId, useState } from 'react';
import type { Project } from '../../../services/projectsData';
import Badge from '../Badge/Badge';
import Card from '../Card/Card';
import styles from './ProjectCard.module.css';

interface ProjectCardProps {
  project: Project;
}

// Helper function to highlight numbers, metrics, and code elements in text
const highlightMetrics = (text: string) => {
  // Combined pattern to match:
  // 1. Numbers with optional units/suffixes (95%, 200+, <30, etc.)
  // 2. Single-quoted code elements ('AssertionError', 'check_for_loops')
  // 3. Technical terms in backticks
  const pattern = /(<?\d+\.?\d*[+%]?|[<>≤≥]\d+)|'([^']+)'|`([^`]+)`/g;
  const parts: (string | React.ReactElement)[] = [];
  let lastIndex = 0;
  let match;
  
  while ((match = pattern.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    
    // Determine type and add highlighted element
    if (match[1]) {
      // Numeric metric
      parts.push(
        <span key={match.index} className={styles.highlightedMetric}>
          {match[1]}
        </span>
      );
    } else if (match[2] || match[3]) {
      // Code element (single quote or backtick)
      const code = match[2] || match[3];
      parts.push(
        <span key={match.index} className={styles.highlightedCode}>
          {code}
        </span>
      );
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  
  return parts.length > 0 ? parts : text;
};

const ProjectCard: React.FC<ProjectCardProps> = ({ project }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const titleId = useId();

  return (
    <Card
      as="article"
      tone="accent"
      interactive
      featured={project.featured}
      padding="none"
      labelledBy={titleId}
      className={styles.projectCard}
    >
      <div className={styles.projectHeader}>
        <div className={styles.headerContent}>
          <h3 id={titleId} className={styles.projectTitle}>
            {project.title}
          </h3>
          {project.subtitle && <p className={styles.projectSubtitle}>{project.subtitle}</p>}
          <div className={styles.projectMeta}>
            <span className={styles.period}>{project.period}</span>
            {project.client && <span className={styles.client}>• {project.client}</span>}
          </div>
        </div>
        {project.featured && <Badge className={styles.featuredBadge}>Featured</Badge>}
      </div>

      <p className={styles.projectDescription}>{project.description}</p>

      {/* Expandable Details */}
      {(project.challenge || project.solution || project.impact) && (
        <div className={styles.expandableSection}>
          <button 
            className={styles.expandButton}
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
          >
            {isExpanded ? '▼ Hide Details' : '▶ Show Details'}
          </button>
          
          {isExpanded && (
            <div className={styles.projectDetails}>
              {project.challenge && (
                <div className={styles.detailBlock}>
                  <h4>Challenge</h4>
                  <p>{highlightMetrics(project.challenge)}</p>
                </div>
              )}
              {project.solution && (
                <div className={styles.detailBlock}>
                  <h4>Solution</h4>
                  <p>{highlightMetrics(project.solution)}</p>
                </div>
              )}
              {project.impact && (
                <div className={styles.detailBlock}>
                  <h4>Impact</h4>
                  <p>{highlightMetrics(project.impact)}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tech Stack */}
      <div className={styles.techStack}>
        {project.techStack.map((tech) => (
          <span key={tech} className={styles.techTag}>{tech}</span>
        ))}
        {project.methodologies.map((method) => (
          <span key={method} className={`${styles.techTag} ${styles.methodology}`}>{method}</span>
        ))}
      </div>

      {/* Links */}
      <div className={styles.projectLinks}>
        {project.links.map((link) => {
          const isComingSoon = link.name.toLowerCase().includes('coming soon');
          return isComingSoon ? (
            <span 
              key={link.name} 
              className={`${styles.projectLink} ${styles.disabled}`}
              title="Coming soon"
            >
              {link.name}
            </span>
          ) : (
            <a 
              key={link.name} 
              href={link.url} 
              className={styles.projectLink}
              target={link.url.startsWith('http') ? '_blank' : undefined}
              rel={link.url.startsWith('http') ? 'noopener noreferrer' : undefined}
            >
              {link.name}
            </a>
          );
        })}
      </div>
    </Card>
  );
};

export default ProjectCard;
