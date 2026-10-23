"""集中配置。所有可调参数只在这里出现一次，避免散落在业务代码里。"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    # 模型档位：fast 用于改写/分类/打分，smart 用于最终生成
    model_fast: str = "deepseek/deepseek-chat"
    model_smart: str = "deepseek/deepseek-chat"
    model_fallback: str = "ollama/qwen2.5:7b"

    # auto  = 没检测到 API key 时自动走 mock（零成本验证链路）
    # mock  = 强制假模型，用于本地跑通与 CI
    # live  = 强制真实模型
    llm_mode: str = "auto"

    # 显式声明这三个字段，.env 里填的 key 才会被读进来。
    # 只写在 .env 而 Settings 没有对应字段的话，extra="ignore" 会直接丢掉，
    # 表现为「明明配了 key 却一直走 mock」。
    deepseek_api_key: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None

    # 单次调用超时（秒）。真实系统里这个值比模型选择更影响体感
    request_timeout: int = 60

    # 存储
    database_url: str = "sqlite:///./kb_agent.db"

    # 向量库：local = 嵌入式（不需要 Docker，数据落在本地目录）；server = 连 Qdrant 服务
    qdrant_mode: str = "local"
    qdrant_path: str = "./.qdrant"
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "kb_chunks"

    # embedding：fastembed 本地跑，不需要 key，也不出网（首次要下模型）
    # 可选 openai / ollama，但那两个需要对应 key 或本地服务
    embed_provider: str = "fastembed"
    embed_model: str = "BAAI/bge-small-zh-v1.5"
    embed_dim: int = 512

    # 检索参数（第 2 周会反复调）
    chunk_size: int = 600
    chunk_overlap: int = 80
    retrieve_top_k: int = 8
    rerank_top_n: int = 3

    # 判分阈值。三个值都是实测出来的，不是拍脑袋：
    # 用 bge-small-zh-v1.5 在样例语料上量了 10 条问题——
    #   真相关问题：0.50 ~ 0.74
    #   不相关问题：0.41 ~ 0.47（密集检索永远会返回点东西，这是关键）
    # 两类在 0.47~0.50 之间几乎贴着，单阈值切不干净（实测同一句话
    # 加不加问号能从 0.5257 掉到 0.50 以下）。
    # 所以用两段式：>0.60 直接判相关；<0.35 直接判无关；
    # 中间这段交给 LLM 判一次相关性（只对 top-1 判，成本可忽略）。
    vector_score_threshold: float = 0.60  # 高于此直接判相关
    vector_grade_floor: float = 0.35      # 低于此直接判无关
    keyword_score_threshold: float = 0.22

    redis_url: str = "redis://localhost:6379/0"

    # 分流阈值：低于它转人工
    classify_confidence_threshold: float = 0.7

    # 鉴权
    # 生产必须换成随机值并从环境变量注入；开发默认值只为方便跑起来
    jwt_secret: str = "dev-only-change-me-in-production"
    jwt_algorithm: str = "HS256"
    token_expire_minutes: int = 720

    # 可观测
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str = "http://localhost:3001"

    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def tracing_enabled(self) -> bool:
        return bool(self.langfuse_public_key and self.langfuse_secret_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
