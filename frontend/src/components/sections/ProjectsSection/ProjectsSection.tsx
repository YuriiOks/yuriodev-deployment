import React from 'react';
import { projectsData } from '../../../services/projectsData';
import ProjectCard from '../../ui/ProjectCard/ProjectCard';
import Section from '../../layout/Section/Section';
import SectionHeader from '../../ui/SectionHeader/SectionHeader';
import styles from './ProjectsSection.module.css';

const ProjectsSection: React.FC = () => {
  return (
    <Section id="projects" containerClassName={styles.inner}>
      <SectionHeader
        id="projects-title"
        title="Featured Projects"
        subtitle="Recent work demonstrating agentic AI systems, educational platform engineering, and production-grade architecture from first principles."
      />
      <div className={styles.projectsShowcase}>
        {projectsData.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </Section>
  );
};

export default ProjectsSection;
