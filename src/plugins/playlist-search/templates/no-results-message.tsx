export interface NoResultsMessageProps {
  id: string;
  text: string;
}

export const NoResultsMessage = (props: NoResultsMessageProps) => (
  <div
    id={`pear-pls-${props.id}-no-results-message`}
    class="pear-pls-no-results-message"
  >
    {props.text}
  </div>
);
