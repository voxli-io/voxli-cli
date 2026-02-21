export interface VoxliConfig {
  apiKey: string;
}

export interface RegisterPayload {
  name: string;
  unique_identifier: string;
}

export interface RegisterResponse {
  test_result_ids?: string[];
  run_id?: string;
}
