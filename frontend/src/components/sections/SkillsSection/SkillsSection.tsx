import React from 'react';
import { skillsData } from '../../../services/skillsData';
import SkillTerminal from '../../ui/SkillTerminal/SkillTerminal';
import Section from '../../layout/Section/Section';
import SectionHeader from '../../ui/SectionHeader/SectionHeader';
import styles from './SkillsSection.module.css';

const SkillsSection: React.FC = () => {
  return (
    <Section id="skills" containerClassName={styles.inner}>
      <SectionHeader
        id="skills-title"
        title="Technical Competency Matrix"
        subtitle="Comprehensive skill set spanning AI/ML engineering, full-stack development, research methodology, and educational design."
      />
      <div className={styles.skillsMatrix}>
        {skillsData.map((skill) => (
          <SkillTerminal key={skill.id} skill={skill} />
        ))}
      </div>
    </Section>
  );
};

export default SkillsSection;
