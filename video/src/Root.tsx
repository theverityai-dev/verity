import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { loadFonts } from "./film/fonts";
import { TIMELINE } from "./film/timeline";
import { Film, type FilmProps } from "./Film";
import { Lab } from "./lab/Lab";

loadFonts();

/** Duration follows the narration clock; fps is a prop so one composition serves 60 and 30. */
const filmMetadata: CalculateMetadataFunction<FilmProps> = ({ props }) => ({
  fps: props.fps,
  durationInFrames: Math.ceil(TIMELINE.total * props.fps),
});

export const Root: React.FC = () => (
  <>
    <Composition
      id="ManufacturingFilm"
      component={Film}
      width={1920}
      height={1080}
      fps={60}
      durationInFrames={Math.ceil(TIMELINE.total * 60)}
      defaultProps={{ fps: 60, captions: false }}
      calculateMetadata={filmMetadata}
    />
    <Composition id="Lab" component={Lab} width={1920} height={1080} fps={60} durationInFrames={60} defaultProps={{ which: "skid" as const }} />
  </>
);
