import { MAX_RETRIEVAL_TOP_K } from '../../retrieval/services/retrieval.service';

/* Matches RetrievalQueryValidator's default maximum so oversized queries fail before persistence */
export const MAX_QUERY_LENGTH = 2000;
export const MAX_TITLE_LENGTH = 200;
export const MAX_IDENTIFIER_LENGTH = 128;
export const MAX_TOP_K = MAX_RETRIEVAL_TOP_K;
