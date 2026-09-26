import React, { useState } from 'react';
import { timelineData, type TimelineEventType } from '../../../data/timelineData';
import Section from '../../layout/Section/Section';
import SectionHeader from '../../ui/SectionHeader/SectionHeader';
import TimelineItem from './TimelineItem';
import styles from './TimelineSection.module.css';

const TimelineSection: React.FC = () => {
  const [filter, setFilter] = useState<TimelineEventType | 'all'>('experience');

  const filteredEvents = filter === 'all' 
    ? timelineData 
    : timelineData.filter(event => event.type === filter);

  return (
    <Section id="timeline" className={styles.section}>
      <SectionHeader
        id="timeline-title"
        title="Journey"
        subtitle="Career milestones, education, and key achievements"
      />

      {/* Filter Buttons */}
      <div className={styles.filterButtons}>
        <button
          className={`${styles.filterButton} ${filter === 'all' ? styles.active : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({timelineData.length})
        </button>
        <button
          className={`${styles.filterButton} ${filter === 'experience' ? styles.active : ''}`}
          onClick={() => setFilter('experience')}
        >
          Experience ({timelineData.filter(e => e.type === 'experience').length})
        </button>
        <button
          className={`${styles.filterButton} ${filter === 'education' ? styles.active : ''}`}
          onClick={() => setFilter('education')}
        >
          Education ({timelineData.filter(e => e.type === 'education').length})
        </button>
        <button
          className={`${styles.filterButton} ${filter === 'certification' ? styles.active : ''}`}
          onClick={() => setFilter('certification')}
        >
          Certifications ({timelineData.filter(e => e.type === 'certification').length})
        </button>
        <button
          className={`${styles.filterButton} ${filter === 'achievement' ? styles.active : ''}`}
          onClick={() => setFilter('achievement')}
        >
          Achievements ({timelineData.filter(e => e.type === 'achievement').length})
        </button>
      </div>

      {/* Timeline */}
      <div className={styles.timeline}>
        {filteredEvents.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No events found for this filter.</p>
          </div>
        ) : (
          filteredEvents.map((event, index) => (
            <TimelineItem
              key={event.id}
              event={event}
              index={index}
            />
          ))
        )}
      </div>
    </Section>
  );
};

export default TimelineSection;
