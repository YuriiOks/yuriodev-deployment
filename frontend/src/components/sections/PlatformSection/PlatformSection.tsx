import React from 'react';
import { platformData } from '../../../data/platformData';
import styles from './PlatformSection.module.css';

const PlatformSection: React.FC = () => {
  return (
    <section id="platform" className={styles.sectionFullwidthShaded}>
      <div className={styles.sectionContentWrapper}>
        {/* Header */}
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{platformData.name}</h2>
          <p className={styles.tagline}>{platformData.tagline}</p>
          <p className={styles.mission}>{platformData.mission}</p>
        </div>

        {/* Current Phase Progress */}
        <div className={styles.currentPhaseCard}>
          <div className={styles.phaseHeader}>
            <h3 className={styles.phaseTitle}>
              Phase {platformData.currentPhase.phase}: {platformData.currentPhase.title}
            </h3>
            <span className={styles.progressPercentage}>{platformData.currentPhase.progress}%</span>
          </div>
          <div className={styles.progressBar}>
            <div 
              className={styles.progressFill}
              style={{ width: `${platformData.currentPhase.progress}%` }}
            />
          </div>
        </div>

        {/* Roadmap */}
        <div className={styles.roadmapSection}>
          <h3 className={styles.roadmapTitle}>Roadmap</h3>
          <div className={styles.roadmapGrid}>
            {platformData.roadmap.map((phase) => (
              <div 
                key={phase.phase}
                className={`${styles.roadmapCard} ${styles[phase.status]}`}
              >
                <div className={styles.phaseNumber}>Phase {phase.phase}</div>
                <h4 className={styles.phaseCardTitle}>{phase.title}</h4>
                <p className={styles.phaseDescription}>{phase.description}</p>
                <div className={styles.statusBadge}>
                  {phase.status === 'completed' && '✓ Completed'}
                  {phase.status === 'active' && '⚡ Active'}
                  {phase.status === 'planned' && '📋 Planned'}
                </div>
                {phase.completionDate && (
                  <div className={styles.completionDate}>{phase.completionDate}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Features
        <div className={styles.featuresSection}>
          <h3 className={styles.featuresTitle}>Features & Tools</h3>
          <div className={styles.featuresGrid}>
            {platformData.features.map((feature, index) => (
              <div key={index} className={`${styles.featureCard} ${styles[feature.status]}`}>
                <div className={styles.featureIcon}>{feature.icon}</div>
                <h4 className={styles.featureTitle}>{feature.title}</h4>
                <p className={styles.featureDescription}>{feature.description}</p>
                <div className={styles.featureFooter}>
                  <span className={`${styles.statusTag} ${styles[feature.status]}`}>
                    {feature.status === 'live' && '🟢 Live'}
                    {feature.status === 'beta' && '🟡 Beta'}
                    {feature.status === 'coming-soon' && '🔵 Coming Soon'}
                  </span>
                  {feature.link && (
                    <a 
                      href={feature.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.featureLink}
                    >
                      View →
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div> */}

        {/* Stats */}
        {/* <div className={styles.statsSection}>
          <div className={styles.statsGrid}>
            {platformData.stats.map((stat, index) => (
              <div key={index} className={styles.statCard}>
                <div className={styles.statValue}>{stat.value}</div>
                <div className={styles.statLabel}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div> */}

        {/* CTA */}
        {/* <div className={styles.ctaSection}>
          <h3 className={styles.ctaTitle}>Join the Journey</h3>
          <p className={styles.ctaDescription}>
            Be part of democratizing AI/ML education. Early access and beta testing opportunities available.
          </p>
          <div className={styles.ctaButtons}>
            <a 
              href={PROJECT_LINKS.pythonCourse} 
              target="_blank"
              rel="noopener noreferrer"
              className={styles.ctaButton}
            >
              Explore Python Course
            </a>
            <a 
              href={`mailto:${EMAILS.personal}?subject=YuriODev Early Access`}
              className={`${styles.ctaButton} ${styles.secondary}`}
            >
              Request Early Access
            </a>
          </div>
        </div> */}
      </div>
    </section>
  );
};

export default PlatformSection;
