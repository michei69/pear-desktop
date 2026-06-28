export interface NoResultsMessageProps {
  id: string;
  text: string;
}

export const NoResultsMessage = (props: NoResultsMessageProps) => (
  <div
    class="pear-pls-no-results-message"
    id={`pear-pls-${props.id}-no-results-message`}
  >
    {props.text}
  </div>
);
