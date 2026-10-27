package com.example.zeca

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import android.content.ContentResolver
import android.net.Uri
import com.example.zeca.ui.CategoriaDenuncia
import com.example.zeca.ui.ClaSocial
import com.example.zeca.ui.ConquistaSocial
import com.example.zeca.ui.ConviteClaSocial
import com.example.zeca.ui.DenunciaSocial
import com.example.zeca.ui.EntradaRankingCla
import com.example.zeca.ui.EstatisticaJogoSocial
import com.example.zeca.ui.EventoSemanal
import com.example.zeca.ui.MembroClã
import com.example.zeca.ui.PartidaHistoricoSocial
import com.example.zeca.ui.PoliticaCla
import com.example.zeca.ui.RascunhoCla
import java.text.SimpleDateFormat
import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

data class PerfilJogador(
    val uid: String,
    val apelido: String,
    val email: String,
    val username: String,
    val profileSetupComplete: Boolean,
    val saldoCentavos: Long,
    val nivel: Int,
    val avatarUrl: String,
    val chavePix: String,
    val tipoChavePix: String,
    val partidas: Int,
    val vitorias: Int,
    val inventario: List<String>,
    val ganhoTotalCentavos: Long,
    val perdaTotalCentavos: Long,
    val molduraEquipada: String,
    val avatarItensEquipados: List<String> = emptyList(),
    val avatarComoFotoPerfil: Boolean = false,
    val tituloEquipado: String = "",
    val bio: String = "",
    val clanId: String = "",
)

data class JogadorRanking(
    val uid: String,
    val apelido: String,
    val saldoCentavos: Long,
    val nivel: Int,
    val avatarUrl: String,
    val username: String = "",
    val avatarItensEquipados: List<String> = emptyList(),
    val avatarComoFotoPerfil: Boolean = false,
    val molduraEquipada: String = "",
)

data class MensagemChat(
    val id: String,
    val autorUid: String,
    val autor: String,
    val texto: String,
    val minha: Boolean,
    val enviadaEmMs: Long,
    val respostaId: String = "",
    val respostaAutor: String = "",
    val respostaTexto: String = "",
    val apagadaParaTodos: Boolean = false,
    val encaminhada: Boolean = false,
    val editada: Boolean = false,
    val usernameAutor: String = "",
    val avatarUrlAutor: String = "",
    val avatarItensAutor: List<String> = emptyList(),
    val avatarComoFotoAutor: Boolean = false,
    val molduraAutor: String = "",
    val audioUrl: String = "",
    val audioDurationMs: Int = 0,
    val statusEnvio: String = "sent",
)

data class PresencaChat(
    val uid: String,
    val online: Boolean,
    val ultimaAtividadeMs: Long,
    val conversaDigitandoId: String,
    val jogoAtivo: String,
)

data class AssinaturaAudioChat(
    val cloudName: String,
    val apiKey: String,
    val folder: String,
    val publicId: String,
    val timestamp: Long,
    val signature: String,
)

data class RespostaChat(
    val id: String,
    val autor: String,
    val texto: String,
)

data class ConversaChat(
    val id: String,
    val outroUid: String,
    val ultimaMensagem: String,
    val atualizadaEmMs: Long,
    val ultimaMensagemId: String = "",
    val ultimoRemetenteUid: String = "",
    val tipo: String = "direct",
    val nome: String = "",
    val descricao: String = "",
    val criadoPorUid: String = "",
    val politicaEditar: String = "creator",
    val politicaEnviar: String = "everyone",
    val participantes: List<String> = emptyList(),
    val adminsUids: List<String> = emptyList(),
    val fotoGrupoUrl: String = "",
    val diasFoguinho: Int = 0,
    val nivelFoguinho: Int = 0,
    val nomeFoguinho: String = "Nosso foguinho",
    val ultimaSequenciaUtc: String = "",
)

data class JogadorDestino(
    val uid: String,
    val apelido: String,
    val nivel: Int,
    val avatarUrl: String,
    val avatarItensEquipados: List<String> = emptyList(),
    val avatarComoFotoPerfil: Boolean = false,
)

data class PerfilPublico(
    val uid: String,
    val apelido: String,
    val username: String,
    val nivel: Int,
    val avatarUrl: String,
    val saldoCentavos: Long,
    val partidas: Int,
    val vitorias: Int,
    val inventario: List<String>,
    val chavePix: String,
    val tipoChavePix: String,
    val molduraEquipada: String,
    val avatarItensEquipados: List<String> = emptyList(),
    val avatarComoFotoPerfil: Boolean = false,
    val tituloEquipado: String = "",
    val bio: String = "",
)

data class ResultadoTransferencia(
    val id: String,
    val nomeDestino: String,
    val saldoCentavos: Long,
)

data class ResultadoJogo(
    val resultado: String,
    val variacaoCentavos: Long,
    val saldoCentavos: Long,
    val partidas: Int,
    val vitorias: Int,
    val multiplicador: Int,
)

data class SessaoCrash(
    val gameId: String,
    val apostaCentavos: Long,
    val iniciadoEmMs: Long,
    val retomada: Boolean,
)

data class ResultadoCrash(
    val caiu: Boolean,
    val multiplicadorBps: Int,
    val premioCentavos: Long,
    val lucroCentavos: Long,
    val saldoCentavos: Long,
    val partidas: Int,
    val vitorias: Int,
)

data class EstadoMinas(
    val gameId: String,
    val status: String,
    val apostaCentavos: Long,
    val quantidadeMinas: Int,
    val casasSeguras: List<Int>,
    val casasMinas: List<Int>,
    val saqueCentavos: Long,
    val multiplicadorBps: Int,
    val lucroCentavos: Long = 0,
    val saldoCentavos: Long = 0,
    val partidas: Int = 0,
    val vitorias: Int = 0,
    val premioNivelCentavos: Long = 0,
    val casaAtingida: Int? = null,
    val retomada: Boolean = false,
)

private fun Map<String, Any>.toEstadoMinas(
    apostaPadrao: Long = 0,
    minasPadrao: Int = 5,
): EstadoMinas = EstadoMinas(
    gameId = this["gameId"] as? String ?: "",
    status = this["status"] as? String ?: "active",
    apostaCentavos = (this["amountCents"] as? Number)?.toLong() ?: apostaPadrao,
    quantidadeMinas = (this["mineCount"] as? Number)?.toInt() ?: minasPadrao,
    casasSeguras = (this["safeCells"] as? List<*>)?.mapNotNull { (it as? Number)?.toInt() }.orEmpty(),
    casasMinas = (this["mineCells"] as? List<*>)?.mapNotNull { (it as? Number)?.toInt() }.orEmpty(),
    saqueCentavos = (this["payoutCents"] as? Number)?.toLong() ?: 0L,
    multiplicadorBps = (this["multiplierBps"] as? Number)?.toInt() ?: 10_000,
    lucroCentavos = (this["profitCents"] as? Number)?.toLong() ?: 0L,
    saldoCentavos = (this["balanceCents"] as? Number)?.toLong() ?: 0L,
    partidas = (this["gamesPlayed"] as? Number)?.toInt() ?: 0,
    vitorias = (this["wins"] as? Number)?.toInt() ?: 0,
    premioNivelCentavos = (this["levelRewardCents"] as? Number)?.toLong() ?: 0L,
    casaAtingida = (this["hitCell"] as? Number)?.toInt(),
    retomada = this["resumed"] as? Boolean ?: false,
)

data class UsuarioAdmin(
    val uid: String,
    val nome: String,
    val username: String,
    val email: String,
    val saldoCentavos: Long,
    val bloqueado: Boolean,
    val avatarUrl: String = "",
    val avatarComoFotoPerfil: Boolean = false,
    val avatarItensEquipados: List<String> = emptyList(),
    val molduraEquipada: String = "",
)

data class MovimentoAdmin(
    val id: String,
    val descricao: String,
    val deltaCentavos: Long,
    val criadoEmMs: Long,
)

data class DetalhesAdmin(
    val usuario: UsuarioAdmin,
    val partidas: Int,
    val vitorias: Int,
    val movimentacoes: List<MovimentoAdmin>,
    val inventario: List<String>,
)

data class ConfiguracaoMinas(
    val rtpBps: Int,
    val minimoMinas: Int,
    val maximoMinas: Int,
)

data class ProgressoMissao(
    val periodo: String,
    val progresso: Int,
    val meta: Int,
    val recompensaCentavos: Long,
    val concluida: Boolean,
)

data class EstadoMissoes(
    val diaria: ProgressoMissao,
    val semanal: ProgressoMissao,
    val diariaEsportiva: ProgressoMissao,
)

data class OpcaoApostaEsportiva(
    val mercadoId: String,
    val mercadoNome: String,
    val selecaoId: String,
    val selecaoNome: String,
    val linha: Double?,
    val oddBps: Int,
    val bookmaker: String,
)

data class PernaApostaEsportiva(
    val fixtureId: Int,
    val campeonato: String,
    val mandante: String,
    val visitante: String,
    val kickoffMs: Long,
    val mercadoId: String,
    val mercadoNome: String,
    val selecaoId: String,
    val selecaoNome: String,
    val linha: Double?,
    val oddBps: Int,
)

data class PartidaEsportiva(
    val fixtureId: Int,
    val kickoffMs: Long,
    val campeonato: String,
    val mandante: String,
    val visitante: String,
    val oddMandanteBps: Int,
    val oddVisitanteBps: Int,
    val mercados: List<OpcaoApostaEsportiva> = emptyList(),
)

data class ApostaEsportiva(
    val id: String,
    val fixtureId: Int,
    val campeonato: String,
    val mandante: String,
    val visitante: String,
    val kickoffMs: Long,
    val selecao: String,
    val nomeSelecao: String,
    val oddBps: Int,
    val valorCentavos: Long,
    val status: String,
    val resultado: String,
    val premioCentavos: Long,
    val pernas: List<PernaApostaEsportiva> = emptyList(),
)

data class MembroSalaCaboGuerra(
    val uid: String,
    val nome: String,
    val time: String,
    val online: Boolean = false,
)

data class SalaCaboGuerra(
    val id: String,
    val criadorUid: String,
    val criadorNome: String,
    val oponenteUid: String,
    val oponenteNome: String,
    val convitesUids: List<String>,
    val apostaCentavos: Long,
    val protegidaPorSenha: Boolean,
    val status: String,
    val puxoesCriador: Int,
    val puxoesOponente: Int,
    val vencedorUid: String,
    val atualizadaEmMs: Long,
    val conviteParaMim: Boolean,
    val modo: String = "1v1",
    val timeA: List<MembroSalaCaboGuerra> = emptyList(),
    val timeB: List<MembroSalaCaboGuerra> = emptyList(),
    val puxoesTimeA: Int = 0,
    val puxoesTimeB: Int = 0,
    val versaoConvite: Int = 0,
    val timeVencedor: String = "",
    val puxoesAceitos: Int = 0,
    val gameId: String = "tug",
    val ultimoJogadorPorTime: Map<String, String> = emptyMap(),
    val jogadoresQueSairam: List<String> = emptyList(),
    val clanId: String = "",
)

data class PartidaJokenpo(
    val id: String,
    val status: String,
    val jogadorUids: List<String>,
    val nomesJogadores: Map<String, String>,
    val escolhas: Map<String, String>,
    val vencedorUid: String,
    val resultado: String,
    val gameId: String = "rps",
    val revengeRequestedBy: List<String> = emptyList(),
    val revengeExpiresAtMs: Long = 0L,
)

data class ResultadoJokenpo(
    val status: String,
    val vencedorUid: String,
    val resultado: String,
)

private fun Map<*, *>.toSalaCaboGuerra(): SalaCaboGuerra? {
    val roomId = this["roomId"] as? String ?: return null
    val creatorUid = this["creatorUid"] as? String ?: ""
    val creatorName = this["creatorName"] as? String ?: "Jogador"
    val opponentUid = this["opponentUid"] as? String ?: ""
    val opponentName = this["opponentName"] as? String ?: ""
    val players = (this["players"] as? List<*>)?.mapNotNull { raw ->
        val player = raw as? Map<*, *> ?: return@mapNotNull null
        val uid = player["uid"] as? String ?: return@mapNotNull null
        MembroSalaCaboGuerra(
            uid = uid,
            nome = player["name"] as? String ?: "Jogador",
            time = player["team"] as? String ?: "A",
            online = player["online"] as? Boolean ?: false,
        )
    }.orEmpty().ifEmpty {
        buildList {
            if (creatorUid.isNotBlank()) add(MembroSalaCaboGuerra(creatorUid, creatorName, "A"))
            if (opponentUid.isNotBlank()) add(MembroSalaCaboGuerra(opponentUid, opponentName, "B"))
        }
    }
    return SalaCaboGuerra(
        id = roomId,
        criadorUid = creatorUid,
        criadorNome = creatorName,
        oponenteUid = opponentUid,
        oponenteNome = opponentName,
        convitesUids = (this["invitedUids"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
        apostaCentavos = (this["stakeCents"] as? Number)?.toLong() ?: 0L,
        protegidaPorSenha = this["passwordProtected"] as? Boolean ?: false,
        status = this["status"] as? String ?: "waiting",
        puxoesCriador = (this["creatorPulls"] as? Number)?.toInt() ?: 0,
        puxoesOponente = (this["opponentPulls"] as? Number)?.toInt() ?: 0,
        vencedorUid = this["winnerUid"] as? String ?: "",
        atualizadaEmMs = (this["lastUpdatedAtMs"] as? Number)?.toLong() ?: 0L,
        conviteParaMim = this["isInvited"] as? Boolean ?: false,
        modo = this["mode"] as? String ?: "1v1",
        timeA = players.filter { it.time == "A" },
        timeB = players.filter { it.time == "B" },
        puxoesTimeA = (this["teamAPulls"] as? Number)?.toInt()
            ?: (this["creatorPulls"] as? Number)?.toInt() ?: 0,
        puxoesTimeB = (this["teamBPulls"] as? Number)?.toInt()
            ?: (this["opponentPulls"] as? Number)?.toInt() ?: 0,
        versaoConvite = (this["inviteVersion"] as? Number)?.toInt() ?: 0,
        timeVencedor = this["winnerTeam"] as? String ?: "",
        puxoesAceitos = (this["acceptedPulls"] as? Number)?.toInt() ?: 0,
        gameId = this["gameId"] as? String ?: "tug",
        ultimoJogadorPorTime = (this["lastPlayerByTeam"] as? Map<*, *>)
            ?.mapNotNull { (team, uid) ->
                val teamName = team as? String ?: return@mapNotNull null
                val playerUid = uid as? String ?: return@mapNotNull null
                teamName to playerUid
            }
            ?.toMap()
            .orEmpty(),
        jogadoresQueSairam = (this["exitedUids"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
        clanId = this["clanId"] as? String ?: "",
    )
}

data class CartaBlackjack(val rank: String, val suit: String)

data class EstadoBlackjack(
    val gameId: String,
    val status: String,
    val cartasJogador: List<CartaBlackjack>,
    val cartasDealer: List<CartaBlackjack>,
    val cartaOculta: Boolean,
    val apostaCentavos: Long,
    val resultado: String,
    val premioCentavos: Long,
    val lucroCentavos: Long,
    val saldoCentavos: Long,
)

data class ResultadoRecursosSociais(
    val clas: List<ClaSocial> = emptyList(),
    val convites: List<ConviteClaSocial> = emptyList(),
    val atualizacoesDenuncias: List<AtualizacaoDenuncia> = emptyList(),
    val claAtualId: String? = null,
    val rankingClas: List<EntradaRankingCla> = emptyList(),
    val eventoSemanal: EventoSemanal? = null,
    val conquistas: List<ConquistaSocial> = emptyList(),
    val historico: List<PartidaHistoricoSocial> = emptyList(),
    val estatisticasPorJogo: List<EstatisticaJogoSocial> = emptyList(),
)

data class DenunciaModeracao(
    val id: String,
    val denunciante: String,
    val usuarioAlvoId: String,
    val usuarioAlvo: String,
    val categoria: String,
    val detalhes: String,
    val status: String,
)

data class PredefinicaoSala(
    val nome: String,
    val modo: String,
    val gameId: String,
    val apostaCentavos: Long,
)

data class AtualizacaoDenuncia(
    val id: String,
    val categoria: String,
    val status: String,
    val motivo: String,
    val criadaEmMs: Long,
)

data class MensagemSalaJogo(
    val id: String,
    val uid: String,
    val nome: String,
    val texto: String,
    val rapida: Boolean,
    val enviadaEmMs: Long,
)

data class PreferenciasConta(
    val profileVisibility: String = "public",
    val customStatus: String = "",
    val theme: String = "dark",
    val locale: String = "pt-BR",
    val accessibilityFontScale: Double = 1.0,
    val highContrast: Boolean = false,
    val reduceMotion: Boolean = false,
    val confirmImportant: Boolean = true,
    val personalizedRecommendations: Boolean = true,
    val syncSettings: Boolean = true,
) {
    fun paraMapa(): Map<String, Any> = mapOf(
        "profileVisibility" to profileVisibility,
        "customStatus" to customStatus,
        "theme" to theme,
        "locale" to locale,
        "accessibilityFontScale" to accessibilityFontScale,
        "highContrast" to highContrast,
        "reduceMotion" to reduceMotion,
        "confirmImportant" to confirmImportant,
        "personalizedRecommendations" to personalizedRecommendations,
        "syncSettings" to syncSettings,
    )
}

data class AmigoConta(
    val uid: String,
    val nome: String,
    val username: String,
    val status: String = "",
    val online: Boolean = false,
)
data class AlteracaoConta(val id: String, val fields: List<String>, val createdAtMs: Long)
data class AvisoApp(val id: String, val title: String, val details: String, val type: String, val expiresAtMs: Long)
data class RecomendacaoJogo(val gameId: String, val played: Int, val wins: Int)
data class VinculoWhatsAppConta(val linked: Boolean = false, val linkedAtMs: Long = 0L)
data class GrupoEconomiaWhatsApp(val name: String, val gold: Long, val bankGold: Long)
data class HistoricoGoldWhatsApp(
    val groupName: String,
    val type: String,
    val item: String,
    val amount: Long,
    val createdAtMs: Long,
)
data class EconomiaWhatsApp(
    val totalGold: Long,
    val totalBankGold: Long,
    val groups: List<GrupoEconomiaWhatsApp>,
    val history: List<HistoricoGoldWhatsApp>,
)
data class PainelConta(
    val preferences: PreferenciasConta = PreferenciasConta(),
    val friends: List<AmigoConta> = emptyList(),
    val friendRequests: List<AmigoConta> = emptyList(),
    val activity: List<AlteracaoConta> = emptyList(),
    val announcements: List<AvisoApp> = emptyList(),
    val recommendations: List<RecomendacaoJogo> = emptyList(),
    val whatsappLink: VinculoWhatsAppConta = VinculoWhatsAppConta(),
)

object FirebaseRepository {
    val auth: FirebaseAuth by lazy { FirebaseAuth.getInstance() }
    private val database by lazy { FirebaseFirestore.getInstance() }
    private const val SERVER_URL = "https://zeca-jvic.onrender.com"
    private const val CLOUDINARY_CLOUD_NAME = "vwctfu9u"
    private const val CLOUDINARY_UPLOAD_PRESET = "zeca_unsigned"
    private const val REQUEST_TIMEOUT_MS = 90_000L
    private val principal = android.os.Handler(android.os.Looper.getMainLooper())

    fun garantirPerfil(user: FirebaseUser, callback: (Exception?) -> Unit) {
        val userRef = database.collection("users").document(user.uid)
        val rankRef = database.collection("leaderboard").document(user.uid)
        val nomeConta = (user.displayName ?: user.email?.substringBefore('@') ?: "Jogador")
            .trim()
            .take(24)
            .let { if (it.length >= 2) it else "Jogador" }
        database.runTransaction { transaction ->
            val userSnapshot = transaction.get(userRef)
            val rankSnapshot = transaction.get(rankRef)
            if (!userSnapshot.exists()) {
                val profile = mapOf(
                    "uid" to user.uid,
                    "displayName" to nomeConta,
                    "username" to "",
                    "profileSetupComplete" to false,
                    "email" to (user.email ?: ""),
                    "balanceCents" to 50_000L,
                    "balanceInitialized" to true,
                    "level" to 1L,
                    "avatarUrl" to (user.photoUrl?.toString() ?: ""),
                    "avatarAsProfilePhoto" to false,
                    "equippedAvatarItems" to emptyList<String>(),
                    "equippedFrame" to "",
                    "pixKey" to "",
                    "pixKeyType" to "",
                    "pixKeyHash" to "",
                    "gamesPlayed" to 0L,
                    "wins" to 0L,
                    "inventory" to emptyList<String>(),
                    "createdAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
                )
                transaction.set(userRef, profile)
                transaction.set(
                    rankRef,
                    mapOf(
                        "displayName" to nomeConta,
                        "username" to "",
                        "balanceCents" to 50_000L,
                        "level" to 1L,
                        "avatarUrl" to (user.photoUrl?.toString() ?: ""),
                        "avatarAsProfilePhoto" to false,
                        "equippedAvatarItems" to emptyList<String>(),
                    ),
                )
            } else {
                val profile = userSnapshot.data ?: emptyMap()
                val balance = (profile["balanceCents"] as? Number)?.toLong()?.coerceAtLeast(0L) ?: 0L
                val initialized = profile["balanceInitialized"] == true
                val gamesPlayed = (profile["gamesPlayed"] as? Number)?.toLong() ?: 0L
                val wins = (profile["wins"] as? Number)?.toLong() ?: 0L
                val canReceiveStartingBalance = !initialized && balance == 0L && gamesPlayed == 0L && wins == 0L
                val nextBalance = if (canReceiveStartingBalance) 50_000L else balance
                val updates = mutableMapOf<String, Any>()
                if (!initialized || nextBalance != balance) {
                    updates["balanceInitialized"] = true
                    updates["balanceCents"] = nextBalance
                }
                val profileName = profile["displayName"] as? String ?: nomeConta
                val username = profile["username"] as? String ?: ""
                val profileLevel = (profile["level"] as? Number)?.toLong()?.takeIf { it > 0L } ?: 1L
                val profileAvatar = (profile["avatarUrl"] as? String).orEmpty()
                    .ifBlank { user.photoUrl?.toString().orEmpty() }
                val avatarAsProfilePhoto = profile["avatarAsProfilePhoto"] as? Boolean ?: false
                val equippedAvatarItems = (profile["equippedAvatarItems"] as? List<*>)?.filterIsInstance<String>().orEmpty()
                val equippedFrame = profile["equippedFrame"] as? String ?: ""
                if ("avatarAsProfilePhoto" !in profile) updates["avatarAsProfilePhoto"] = false
                if ("equippedAvatarItems" !in profile) updates["equippedAvatarItems"] = emptyList<String>()
                if (updates.isNotEmpty()) transaction.update(userRef, updates)
                val publicProfile = mapOf(
                    "displayName" to profileName,
                    "username" to username,
                    "balanceCents" to nextBalance,
                    "level" to profileLevel,
                    "avatarUrl" to profileAvatar,
                    "avatarAsProfilePhoto" to avatarAsProfilePhoto,
                    "equippedAvatarItems" to equippedAvatarItems,
                    "equippedFrame" to equippedFrame,
                )
                if (!rankSnapshot.exists()) transaction.set(rankRef, publicProfile)
                else transaction.update(
                    rankRef,
                    mapOf(
                        "displayName" to profileName,
                        "username" to username,
                        "balanceCents" to nextBalance,
                        "level" to profileLevel,
                        "avatarUrl" to profileAvatar,
                        "avatarAsProfilePhoto" to avatarAsProfilePhoto,
                        "equippedAvatarItems" to equippedAvatarItems,
                        "equippedFrame" to equippedFrame,
                    ),
                )
            }
            null
        }
            .addOnSuccessListener {
                callback(null)
                if (!user.photoUrl?.toString().isNullOrBlank()) {
                    chamarFunction("ensurePlayerProfile", emptyMap()) { _, _ -> }
                }
            }
            .addOnFailureListener {
                chamarFunction("ensurePlayerProfile", emptyMap()) { _, fallbackError ->
                    callback(fallbackError?.let(::erroParaPerfilServidor))
                }
            }
    }

    fun observarPerfil(uid: String, callback: (PerfilJogador?) -> Unit): ListenerRegistration =
        database.collection("users").document(uid).addSnapshotListener { snapshot, _ ->
            callback(snapshot?.let(::toPerfil))
        }

    fun observarRanking(callback: (List<JogadorRanking>) -> Unit): ListenerRegistration =
        database.collection("leaderboard")
            .orderBy("balanceCents", Query.Direction.DESCENDING)
            .limit(50)
            .addSnapshotListener { snapshot, _ ->
                callback(snapshot?.documents.orEmpty().mapNotNull(::toJogadorRanking))
            }

    fun buscarJogadoresPorUsername(prefixo: String, callback: (List<JogadorRanking>, Exception?) -> Unit) {
        val prefixoNormalizado = prefixo.trim().removePrefix("@").lowercase(java.util.Locale.ROOT)
        if (prefixoNormalizado.isBlank()) {
            callback(emptyList(), null)
            return
        }
        database.collection("leaderboard")
            .orderBy("username")
            .startAt(prefixoNormalizado)
            .endAt("$prefixoNormalizado\uf8ff")
            .limit(5)
            .get()
            .addOnSuccessListener { snapshot ->
                callback(snapshot.documents.mapNotNull(::toJogadorRanking), null)
            }
            .addOnFailureListener { error -> callback(emptyList(), error) }
    }

    fun observarPresencasChat(callback: (List<PresencaChat>) -> Unit): ListenerRegistration =
        database.collection("userPresence")
            .whereEqualTo("online", true)
            .limit(100)
            .addSnapshotListener { snapshot, _ ->
                callback(snapshot?.documents.orEmpty().mapNotNull { document ->
                    val data = document.data ?: return@mapNotNull null
                    val lastSeen = data["lastSeenAt"] as? com.google.firebase.Timestamp
                    PresencaChat(
                        uid = document.id,
                        online = data["online"] as? Boolean ?: false,
                        ultimaAtividadeMs = lastSeen?.toDate()?.time ?: 0L,
                        conversaDigitandoId = data["typingChatId"] as? String ?: "",
                        jogoAtivo = data["activeGame"] as? String ?: "",
                    )
                })
            }

    fun atualizarPresencaChat(online: Boolean, jogoAtivo: String = "", conversaDigitandoId: String = "") {
        val uid = auth.currentUser?.uid ?: return
        database.collection("userPresence").document(uid).set(
            mapOf(
                "uid" to uid,
                "online" to online,
                "lastSeenAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
                "activeGame" to jogoAtivo.take(40),
                "typingChatId" to conversaDigitandoId.take(160),
            ),
            com.google.firebase.firestore.SetOptions.merge(),
        )
    }

    fun observarMensagensChat(
        chatId: String,
        uidAtual: String,
        callback: (List<MensagemChat>, Exception?, Boolean) -> Unit,
    ): ListenerRegistration = database.collection("chats").document(chatId).collection("messages")
        .orderBy("createdAt", Query.Direction.DESCENDING)
        .limit(80)
        .addSnapshotListener { snapshot, error ->
            val mensagens = snapshot?.documents.orEmpty().mapNotNull { document ->
                val data = document.data ?: return@mapNotNull null
                val ocultaPara = (data["deletedFor"] as? List<*>)?.filterIsInstance<String>().orEmpty()
                if (uidAtual in ocultaPara) return@mapNotNull null
                MensagemChat(
                    id = document.id,
                    autorUid = data["senderUid"] as? String ?: return@mapNotNull null,
                    autor = data["senderName"] as? String ?: "Jogador",
                    texto = data["text"] as? String ?: return@mapNotNull null,
                    minha = data["senderUid"] == uidAtual,
                    enviadaEmMs = (data["createdAt"] as? com.google.firebase.Timestamp)?.toDate()?.time ?: 0L,
                    respostaId = data["replyToId"] as? String ?: "",
                    respostaAutor = data["replyToName"] as? String ?: "",
                    respostaTexto = data["replyToText"] as? String ?: "",
                    apagadaParaTodos = data["deletedForAll"] as? Boolean ?: false,
                    encaminhada = data["forwarded"] as? Boolean ?: false,
                    editada = data["editedAt"] != null,
                    usernameAutor = data["senderUsername"] as? String ?: "",
                    avatarUrlAutor = data["senderAvatarUrl"] as? String ?: "",
                    avatarItensAutor = (data["senderAvatarItems"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
                    avatarComoFotoAutor = data["senderAvatarAsProfilePhoto"] as? Boolean ?: false,
                    molduraAutor = data["senderEquippedFrame"] as? String ?: "",
                    audioUrl = data["audioUrl"] as? String ?: "",
                    audioDurationMs = (data["audioDurationMs"] as? Number)?.toInt() ?: 0,
                )
            }.sortedBy { it.enviadaEmMs }
            callback(mensagens, error, snapshot?.metadata?.isFromCache ?: true)
        }

    fun observarLeiturasChat(
        chatId: String,
        callback: (Map<String, Long>, Exception?) -> Unit,
    ): ListenerRegistration = database.collection("chats").document(chatId).collection("readReceipts")
        .addSnapshotListener { snapshot, error ->
            val leituras = snapshot?.documents.orEmpty().mapNotNull { document ->
                document.getTimestamp("lastReadAt")?.toDate()?.time?.let { document.id to it }
            }.toMap()
            callback(leituras, error)
        }

    fun marcarChatComoLido(chatId: String, messageId: String) {
        val uid = auth.currentUser?.uid ?: return
        database.collection("chats").document(chatId).collection("readReceipts").document(uid).set(
            mapOf(
                "lastReadMessageId" to messageId,
                "lastReadAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
            ),
            com.google.firebase.firestore.SetOptions.merge(),
        )
    }

    fun observarConversasChat(
        uid: String,
        callback: (List<ConversaChat>, Exception?, Boolean) -> Unit,
    ): ListenerRegistration =
        database.collection("chats")
            .whereArrayContains("participantUids", uid)
            .limit(100)
            .addSnapshotListener { snapshot, error ->
                val conversas = snapshot?.documents.orEmpty().mapNotNull { document ->
                    val participantes = (document.get("participantUids") as? List<*>)
                        ?.filterIsInstance<String>() ?: return@mapNotNull null
                    if (uid !in participantes) return@mapNotNull null
                    ConversaChat(
                        id = document.id,
                        outroUid = participantes.firstOrNull { it != uid }.orEmpty(),
                        ultimaMensagem = document.getString("lastMessage") ?: "",
                        atualizadaEmMs = document.getTimestamp("lastMessageAt")?.toDate()?.time ?: 0L,
                        ultimaMensagemId = document.getString("lastMessageId") ?: "",
                        ultimoRemetenteUid = document.getString("lastMessageSenderUid") ?: "",
                        tipo = document.getString("type") ?: "direct",
                        nome = document.getString("name") ?: "",
                        descricao = document.getString("description") ?: "",
                        criadoPorUid = document.getString("createdBy") ?: "",
                        politicaEditar = document.getString("editPolicy") ?: "creator",
                        politicaEnviar = document.getString("sendPolicy") ?: "everyone",
                        participantes = participantes,
                        adminsUids = (document.get("adminUids") as? List<*>)
                            ?.filterIsInstance<String>()
                            ?.ifEmpty { listOf(document.getString("createdBy").orEmpty()) }
                            .orEmpty(),
                        fotoGrupoUrl = document.getString("photoUrl") ?: "",
                        diasFoguinho = document.getLong("streakDays")?.toInt() ?: 0,
                        nivelFoguinho = document.getLong("streakLevel")?.toInt() ?: 0,
                        nomeFoguinho = document.getString("streakName") ?: "Nosso foguinho",
                        ultimaSequenciaUtc = document.getString("streakLastQualifiedDate") ?: "",
                    )
                }.sortedByDescending { it.atualizadaEmMs }
                callback(conversas, error, snapshot?.metadata?.isFromCache ?: true)
            }

    fun idConversaPrivada(uidUm: String, uidDois: String): String = listOf(uidUm, uidDois).sorted().joinToString("_")

    fun enviarMensagemChat(
        destinatarioUid: String?,
        texto: String,
        requestId: String,
        resposta: RespostaChat?,
        encaminhada: Boolean = false,
        chatId: String? = null,
        audioUrl: String = "",
        audioPublicId: String = "",
        audioDurationMs: Int = 0,
        callback: (String?, Exception?) -> Unit,
    ) {
        val message = texto.trim()
        val hasAudio = audioUrl.isNotBlank()
        if ((!hasAudio && message.isEmpty()) || message.length > 500
            || (hasAudio && (audioPublicId.isBlank() || audioDurationMs !in 500..60_000))) {
            callback(null, IllegalArgumentException("A mensagem deve ter entre 1 e 500 caracteres."))
            return
        }
        val dados = mutableMapOf<String, Any>("text" to message, "requestId" to requestId)
        if (hasAudio) {
            dados["audioUrl"] = audioUrl
            dados["audioPublicId"] = audioPublicId
            dados["audioDurationMs"] = audioDurationMs
        }
        destinatarioUid?.let { dados["recipientUid"] = it }
        chatId?.let { dados["chatId"] = it }
        resposta?.let { dados["reply"] = mapOf("id" to it.id, "name" to it.autor, "text" to it.texto.take(200)) }
        if (encaminhada) dados["forwarded"] = true
        chamarFunction("sendChatMessage", dados) { result, error ->
            callback(result?.get("chatId") as? String, error)
        }
        }

    fun enviarAudioChat(
        arquivo: java.io.File,
        duracaoMs: Int,
        destinatarioUid: String?,
        chatId: String?,
        requestId: String,
        callback: (Exception?) -> Unit,
    ) {
        if (!arquivo.isFile || duracaoMs !in 500..60_000) {
            callback(IllegalArgumentException("Áudio inválido ou maior que 1 minuto."))
            return
        }
        val uid = auth.currentUser?.uid
        if (uid == null) {
            callback(IllegalStateException("Entre na sua conta novamente."))
            return
        }
        val conversationId = chatId ?: destinatarioUid?.let { idConversaPrivada(uid, it) } ?: "global"
        val requestData = mutableMapOf<String, Any>("chatId" to conversationId, "requestId" to requestId)
        destinatarioUid?.let { requestData["recipientUid"] = it }
        chamarFunction("signChatAudioUpload", requestData) { data, signError ->
            if (signError != null || data == null) {
                callback(signError ?: IllegalStateException("Não foi possível preparar o áudio."))
                return@chamarFunction
            }
            Thread {
                var secureUrl: String? = null
                var uploadError: Exception? = null
                try {
                    secureUrl = enviarArquivoAudioCloudinary(arquivo, data)
                } catch (error: Exception) {
                    uploadError = error
                }
                principal.post {
                    if (uploadError != null || secureUrl == null) {
                        callback(uploadError ?: IllegalStateException("O upload não retornou uma URL de áudio."))
                    } else {
                        enviarMensagemChat(
                            destinatarioUid = destinatarioUid,
                            texto = "",
                            requestId = requestId,
                            resposta = null,
                            chatId = chatId,
                            audioUrl = secureUrl,
                            audioPublicId = requestId,
                            audioDurationMs = duracaoMs,
                        ) { _, sendError -> callback(sendError) }
                    }
                }
            }.start()
        }
    }

    private fun enviarArquivoAudioCloudinary(arquivo: java.io.File, assinatura: Map<String, Any>): String {
        val cloudName = assinatura["cloudName"] as? String ?: error("Cloudinary não configurado.")
        val conexao = java.net.URL("https://api.cloudinary.com/v1_1/$cloudName/video/upload")
            .openConnection() as java.net.HttpURLConnection
        val boundary = "----ZecaAudio${java.util.UUID.randomUUID()}"
        try {
            conexao.requestMethod = "POST"
            conexao.connectTimeout = 15_000
            conexao.readTimeout = 60_000
            conexao.doOutput = true
            conexao.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            conexao.outputStream.use { output ->
                val writer = output.bufferedWriter(Charsets.UTF_8)
                val fields = mapOf(
                    "api_key" to assinatura["apiKey"],
                    "timestamp" to assinatura["timestamp"],
                    "signature" to assinatura["signature"],
                    "folder" to assinatura["folder"],
                    "public_id" to assinatura["publicId"],
                )
                fields.forEach { (name, value) ->
                    writer.append("--$boundary\r\n")
                    writer.append("Content-Disposition: form-data; name=\"$name\"\r\n\r\n")
                    writer.append("$value\r\n")
                }
                writer.append("--$boundary\r\n")
                writer.append("Content-Disposition: form-data; name=\"file\"; filename=\"${arquivo.name}\"\r\n")
                writer.append("Content-Type: audio/mp4\r\n\r\n")
                writer.flush()
                arquivo.inputStream().use { it.copyTo(output) }
                output.write("\r\n--$boundary--\r\n".toByteArray(Charsets.UTF_8))
                output.flush()
            }
            val status = conexao.responseCode
            val stream = if (status in 200..299) conexao.inputStream else conexao.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { org.json.JSONObject(body) }.getOrNull()
            if (status !in 200..299) {
                val detail = json?.optJSONObject("error")?.optString("message").orEmpty()
                throw IllegalStateException(detail.ifBlank { "O Cloudinary recusou o áudio ($status)." })
            }
            return json?.optString("secure_url")
                ?.takeIf { it.startsWith("https://res.cloudinary.com/$cloudName/video/upload/") }
                ?: throw IllegalStateException("O Cloudinary não retornou uma URL de áudio segura.")
        } finally {
            conexao.disconnect()
        }
    }

    fun criarGrupo(
        nome: String,
        descricao: String,
        memberUids: List<String>,
        editPolicy: String,
        sendPolicy: String,
        requestId: String,
        callback: (String?, Exception?) -> Unit,
    ) {
        chamarFunction(
            "createChatGroup",
            mapOf(
                "name" to nome,
                "description" to descricao,
                "memberUids" to memberUids,
                "editPolicy" to editPolicy,
                "sendPolicy" to sendPolicy,
                "requestId" to requestId,
            ),
        ) { data, error -> callback(data?.get("chatId") as? String, error) }
    }

    fun atualizarGrupo(
        chatId: String,
        nome: String,
        descricao: String,
        editPolicy: String,
        sendPolicy: String,
        callback: (Exception?) -> Unit,
    ) {
        chamarFunction(
            "updateChatGroup",
            mapOf(
                "chatId" to chatId,
                "name" to nome,
                "description" to descricao,
                "editPolicy" to editPolicy,
                "sendPolicy" to sendPolicy,
            ),
        ) { _, error -> callback(error) }
    }

    fun gerenciarMembrosGrupo(
        chatId: String,
        action: String,
        targetUid: String = "",
        memberUids: List<String> = emptyList(),
        callback: (Exception?) -> Unit,
    ) {
        val data = mutableMapOf<String, Any>("chatId" to chatId, "action" to action)
        if (targetUid.isNotBlank()) data["targetUid"] = targetUid
        if (memberUids.isNotEmpty()) data["memberUids"] = memberUids
        chamarFunction("manageChatGroupMembers", data) { _, error -> callback(error) }
    }

    fun dissolverGrupoChat(chatId: String, callback: (Exception?) -> Unit) {
        chamarFunction("dissolveChatGroup", mapOf("chatId" to chatId)) { _, error -> callback(error) }
    }

    fun atualizarFotoGrupo(chatId: String, photoUrl: String, callback: (Exception?) -> Unit) {
        chamarFunction(
            "updateChatGroupPhoto",
            mapOf("chatId" to chatId, "photoUrl" to photoUrl),
        ) { _, error -> callback(error) }
    }

    fun renomearFoguinho(chatId: String, nome: String, callback: (Exception?) -> Unit) {
        chamarFunction("renameChatFlame", mapOf("chatId" to chatId, "name" to nome)) { _, error -> callback(error) }
    }

    fun apagarMensagemParaMim(chatId: String, mensagemId: String, callback: (Exception?) -> Unit) {
        val uid = auth.currentUser?.uid
        if (uid == null) {
            callback(IllegalStateException("Entre na sua conta novamente."))
            return
        }
        database.collection("chats").document(chatId).collection("messages").document(mensagemId)
            .update("deletedFor", com.google.firebase.firestore.FieldValue.arrayUnion(uid))
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(erroParaUsuario(it)) }
    }

    fun apagarMensagemParaTodos(chatId: String, mensagemId: String, callback: (Exception?) -> Unit) {
        if (auth.currentUser == null) {
            callback(IllegalStateException("Entre na sua conta novamente."))
            return
        }
        database.collection("chats").document(chatId).collection("messages").document(mensagemId)
            .update(mapOf("deletedForAll" to true, "text" to ""))
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(erroParaUsuario(it)) }
    }

    fun editarMensagemChat(chatId: String, mensagemId: String, texto: String, callback: (Exception?) -> Unit) {
        val textoEditado = texto.trim()
        if (textoEditado.isEmpty() || textoEditado.length > 500) {
            callback(IllegalArgumentException("A mensagem deve ter entre 1 e 500 caracteres."))
            return
        }
        chamarFunction(
            "editChatMessage",
            mapOf("chatId" to chatId, "messageId" to mensagemId, "text" to textoEditado),
        ) { _, erro -> callback(erro) }
    }

    fun observarMovimentos(uid: String, callback: (List<Movimento>, Boolean) -> Unit): ListenerRegistration =
        database.collection("users").document(uid).collection("transactions")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(30)
            .addSnapshotListener { snapshot, _ ->
                if (snapshot == null) return@addSnapshotListener
                callback(snapshot.documents.mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    val description = data["description"] as? String ?: "Movimentação"
                    val delta = (data["deltaCents"] as? Number)?.toLong() ?: 0L
                    val transfer = data["type"] == "pix_transfer"
                    val counterparty = description.removePrefix("De ").removePrefix("Para ")
                    Movimento(
                        titulo = when {
                            transfer && delta > 0L -> "Recebido de $counterparty"
                            transfer -> "Enviado para $counterparty"
                            else -> description
                        },
                        variacaoCentavos = delta,
                        horario = (data["createdAt"] as? com.google.firebase.Timestamp)
                            ?.toDate()?.let { java.text.SimpleDateFormat("dd/MM HH:mm", java.util.Locale.forLanguageTag("pt-BR")).format(it) }
                            ?: "Agora",
                        id = doc.id,
                        ehTransferenciaPix = transfer,
                        ehPremioNivel = data["type"] == "level_reward",
                    )
                }, snapshot.metadata.isFromCache)
            }

    fun atualizarPerfil(
        username: String,
        displayName: String,
        avatarUrl: String,
        avatarComoFotoPerfil: Boolean,
        bio: String,
        callback: (Exception?) -> Unit,
    ) {
        chamarFunction(
            "updatePlayerProfile",
            mapOf(
                "username" to username,
                "displayName" to displayName,
                "bio" to bio,
                "avatarUrl" to avatarUrl,
                "avatarAsProfilePhoto" to avatarComoFotoPerfil,
            ),
        ) { _, erro -> callback(erro) }
    }

    fun equiparItemAvatar(slot: String, itemId: String?, callback: (Exception?) -> Unit) {
        chamarFunction(
            "equipAvatarItem",
            mapOf("slot" to slot, "itemId" to (itemId ?: "")),
        ) { _, error -> callback(error) }
    }

    fun equiparTitulo(itemId: String?, callback: (Exception?) -> Unit) {
        chamarFunction("equipTitle", mapOf("itemId" to (itemId ?: ""))) { _, error -> callback(error) }
    }

    fun buscarAdversarioJokenpo(
        gameId: String,
        requestId: String,
        callback: (String, String, Exception?) -> Unit,
    ) {
        chamarFunction("queueJokenpoMatch", mapOf("gameId" to gameId, "requestId" to requestId)) { data, error ->
            callback(data?.get("status") as? String ?: "", data?.get("matchId") as? String ?: "", error)
        }
    }

    fun cancelarFilaJokenpo(callback: (Exception?) -> Unit) {
        chamarFunction("cancelJokenpoQueue", emptyMap()) { _, error -> callback(error) }
    }

    fun observarFilaJokenpo(callback: (String, String, Boolean) -> Unit): ListenerRegistration {
        val uid = auth.currentUser?.uid ?: throw IllegalStateException("Entre na sua conta para buscar uma partida.")
        return database.collection("jokenpoQueue").document(uid).addSnapshotListener { snapshot, _ ->
            callback(
                snapshot?.getString("status") ?: "",
                snapshot?.getString("matchId") ?: "",
                snapshot?.getBoolean("hasPlayed") == true,
            )
        }
    }

    fun observarPartidaJokenpo(
        matchId: String,
        callback: (PartidaJokenpo?, Exception?) -> Unit,
    ): ListenerRegistration = database.collection("jokenpoMatches").document(matchId)
        .addSnapshotListener { snapshot, error ->
            val match = snapshot?.takeIf { it.exists() }?.let { document ->
                val names = (document.get("playerNames") as? Map<*, *>)
                    ?.entries
                    ?.mapNotNull { (uid, name) ->
                        val playerUid = uid as? String ?: return@mapNotNull null
                        val playerName = name as? String ?: return@mapNotNull null
                        playerUid to playerName
                    }
                    ?.toMap()
                    .orEmpty()
                val choices = (document.get("choices") as? Map<*, *>)
                    ?.entries
                    ?.mapNotNull { (uid, choice) ->
                        val playerUid = uid as? String ?: return@mapNotNull null
                        val playerChoice = choice as? String ?: return@mapNotNull null
                        playerUid to playerChoice
                    }
                    ?.toMap()
                    .orEmpty()
                PartidaJokenpo(
                    id = document.id,
                    status = document.getString("status") ?: "",
                    jogadorUids = (document.get("playerUids") as? List<*>)?.filterIsInstance<String>().orEmpty(),
                    nomesJogadores = names,
                    escolhas = if (document.getString("status") == "completed") choices else emptyMap(),
                    vencedorUid = document.getString("winnerUid") ?: "",
                    resultado = document.getString("resultText") ?: "",
                    gameId = document.getString("gameId")
                        ?.let { if (it == "jokenpo") "rps" else it }
                        ?: "rps",
                    revengeRequestedBy = (document.get("rematchRequests") as? Map<*, *>)
                        ?.keys
                        ?.filterIsInstance<String>()
                        .orEmpty(),
                    revengeExpiresAtMs = document.getLong("rematchExpiresAtMs") ?: 0L,
                )
            }
            callback(match, error)
        }

    fun jogarJokenpo(
        matchId: String,
        escolha: String,
        requestId: String,
        callback: (ResultadoJokenpo?, Exception?) -> Unit,
    ) {
        chamarFunction(
            "submitJokenpoChoice",
            mapOf("matchId" to matchId, "choice" to escolha, "requestId" to requestId),
        ) { data, error ->
            val result = data?.let {
                ResultadoJokenpo(
                    status = it["status"] as? String ?: "",
                    vencedorUid = it["winnerUid"] as? String ?: "",
                    resultado = it["resultText"] as? String ?: "",
                )
            }
            callback(result, error)
        }
    }

    fun pedirRevancheJokenpo(
        matchId: String,
        requestId: String,
        callback: (String, String, Exception?) -> Unit,
    ) {
        chamarFunction(
            "requestJokenpoRematch",
            mapOf("matchId" to matchId, "requestId" to requestId),
        ) { data, error ->
            callback(
                data?.get("status") as? String ?: "",
                data?.get("matchId") as? String ?: "",
                error,
            )
        }
    }

    fun enviarFotoPerfil(uri: Uri, contentResolver: ContentResolver, callback: (String?, Exception?) -> Unit) {
        val uid = auth.currentUser?.uid
        if (uid == null) {
            callback(null, IllegalStateException("Entre na sua conta novamente."))
            return
        }
        enviarImagemCloudinary(uri, contentResolver, "zeca/avatars/$uid", "avatar", callback)
    }

    fun enviarFotoGrupo(uri: Uri, chatId: String, contentResolver: ContentResolver, callback: (Exception?) -> Unit) {
        if (auth.currentUser == null) {
            callback(IllegalStateException("Entre na sua conta novamente."))
            return
        }
        enviarImagemCloudinary(uri, contentResolver, "zeca/groups/$chatId", "group") { photoUrl, uploadError ->
            if (uploadError != null || photoUrl == null) {
                callback(uploadError ?: IllegalStateException("O upload não retornou uma foto válida."))
            } else {
                chamarFunction("updateChatGroupPhoto", mapOf("chatId" to chatId, "photoUrl" to photoUrl)) { _, error ->
                    callback(error)
                }
            }
        }
    }

    private fun enviarImagemCloudinary(
        uri: Uri,
        contentResolver: ContentResolver,
        folder: String,
        filePrefix: String,
        callback: (String?, Exception?) -> Unit,
    ) {
        Thread {
            var urlFoto: String? = null
            var erro: Exception? = null
            try {
                val mimeType = contentResolver.getType(uri)?.takeIf { it.startsWith("image/") }
                    ?: "image/jpeg"
                val extensao = mimeType.substringAfter('/', "jpeg").substringBefore('+')
                val boundary = "----ZecaUpload${java.util.UUID.randomUUID()}"
                val conexao = java.net.URL(
                    "https://api.cloudinary.com/v1_1/$CLOUDINARY_CLOUD_NAME/image/upload",
                ).openConnection() as java.net.HttpURLConnection
                try {
                    conexao.requestMethod = "POST"
                    conexao.connectTimeout = 15_000
                    conexao.readTimeout = 60_000
                    conexao.doOutput = true
                    conexao.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
                    conexao.outputStream.use { output ->
                        val writer = output.bufferedWriter(Charsets.UTF_8)
                        writer.append("--$boundary\r\n")
                        writer.append("Content-Disposition: form-data; name=\"upload_preset\"\r\n\r\n")
                        writer.append("$CLOUDINARY_UPLOAD_PRESET\r\n")
                        writer.append("--$boundary\r\n")
                        writer.append("Content-Disposition: form-data; name=\"folder\"\r\n\r\n")
                        writer.append("$folder\r\n")
                        writer.append("--$boundary\r\n")
                        writer.append("Content-Disposition: form-data; name=\"file\"; filename=\"$filePrefix.$extensao\"\r\n")
                        writer.append("Content-Type: $mimeType\r\n\r\n")
                        writer.flush()
                        contentResolver.openInputStream(uri)?.use { input -> input.copyTo(output) }
                            ?: throw IllegalStateException("Não foi possível abrir a imagem escolhida.")
                        output.write("\r\n--$boundary--\r\n".toByteArray(Charsets.UTF_8))
                        output.flush()
                    }
                    val status = conexao.responseCode
                    val fluxo = if (status in 200..299) conexao.inputStream else conexao.errorStream
                    val resposta = fluxo?.bufferedReader()?.use { it.readText() }.orEmpty()
                    val json = runCatching { org.json.JSONObject(resposta) }.getOrNull()
                    if (status !in 200..299) {
                        val detalhe = json?.optJSONObject("error")?.optString("message").orEmpty()
                        throw IllegalStateException(detalhe.ifBlank { "O Cloudinary recusou o upload ($status)." })
                    }
                    urlFoto = json?.optString("secure_url")?.takeIf { it.startsWith("https://res.cloudinary.com/") }
                        ?: throw IllegalStateException("O Cloudinary não retornou uma URL segura para a imagem.")
                } finally {
                    conexao.disconnect()
                }
            } catch (exception: Exception) {
                erro = exception
            }
            principal.post { callback(urlFoto, erro) }
        }.start()
    }

    fun registrarChavePix(tipo: String, chave: String, callback: (Exception?) -> Unit) {
        chamarFunction("registerPixKey", mapOf("type" to tipo, "key" to chave.trim())) { _, erro -> callback(erro) }
    }

    fun reenviarVerificacaoEmail(callback: (Exception?) -> Unit) {
        val usuario = auth.currentUser
        if (usuario == null) {
            callback(IllegalStateException("Entre na sua conta novamente."))
            return
        }
        usuario.sendEmailVerification()
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(erroParaUsuario(it)) }
    }

    fun conferirEmailVerificado(callback: (Boolean, Exception?) -> Unit) {
        val usuario = auth.currentUser
        if (usuario == null) {
            callback(false, IllegalStateException("Entre na sua conta novamente."))
            return
        }
        usuario.reload()
            .addOnSuccessListener { callback(auth.currentUser?.isEmailVerified == true, null) }
            .addOnFailureListener { callback(false, erroParaUsuario(it)) }
    }

    fun buscarChavePix(chave: String, callback: (JogadorDestino?, Exception?) -> Unit) {
        chamarFunction("lookupPixKey", mapOf("key" to chave.trim())) { data, erro ->
            val destino = data?.let {
                JogadorDestino(
                    uid = it["uid"] as? String ?: return@let null,
                    apelido = it["displayName"] as? String ?: "Jogador",
                    nivel = (it["level"] as? Number)?.toInt() ?: 1,
                    avatarUrl = it["avatarUrl"] as? String ?: "",
                    avatarItensEquipados = (it["equippedAvatarItems"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
                    avatarComoFotoPerfil = it["avatarAsProfilePhoto"] as? Boolean ?: false,
                )
            }
            callback(destino, erro)
        }
    }

    fun buscarPerfilPublico(uid: String, callback: (PerfilPublico?, Exception?) -> Unit) {
        chamarFunction("getPlayerProfile", mapOf("uid" to uid)) { data, erro ->
            val perfil = data?.let {
                PerfilPublico(
                    uid = it["uid"] as? String ?: uid,
                    apelido = it["displayName"] as? String ?: "Jogador",
                    username = it["username"] as? String ?: "",
                    nivel = (it["level"] as? Number)?.toInt() ?: 1,
                    avatarUrl = it["avatarUrl"] as? String ?: "",
                    saldoCentavos = (it["balanceCents"] as? Number)?.toLong() ?: 0L,
                    partidas = (it["gamesPlayed"] as? Number)?.toInt() ?: 0,
                    vitorias = (it["wins"] as? Number)?.toInt() ?: 0,
                    inventario = (it["inventory"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
                    chavePix = it["pixKey"] as? String ?: "",
                    tipoChavePix = it["pixKeyType"] as? String ?: "",
                    molduraEquipada = it["equippedFrame"] as? String ?: "",
                    avatarItensEquipados = (it["equippedAvatarItems"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
                    avatarComoFotoPerfil = it["avatarAsProfilePhoto"] as? Boolean ?: false,
                    tituloEquipado = it["equippedTitle"] as? String ?: "",
                    bio = it["bio"] as? String ?: "",
                )
            }
            callback(perfil, erro)
        }
    }

    fun transferirPorPix(chave: String, valorCentavos: Long, requestId: String, callback: (ResultadoTransferencia?, Exception?) -> Unit) {
        chamarFunction(
            "transferByPixKey",
            mapOf("key" to chave.trim(), "amountCents" to valorCentavos, "requestId" to requestId),
        ) { data, erro ->
            val resultado = data?.let {
                ResultadoTransferencia(
                    id = it["transferId"] as? String ?: requestId,
                    nomeDestino = it["recipientName"] as? String ?: "Jogador",
                    saldoCentavos = (it["balanceCents"] as? Number)?.toLong() ?: 0L,
                )
            }
            callback(resultado, erro)
        }
    }

    fun jogar(
        jogo: String,
        apostaCentavos: Long,
        tipoAposta: String,
        selecao: String,
        requestId: String,
        callback: (ResultadoJogo?, Exception?) -> Unit,
    ) {
        chamarFunction(
            "playGame",
            mapOf(
                "game" to jogo,
                "amountCents" to apostaCentavos,
                "betType" to tipoAposta,
                "selection" to selecao,
                "requestId" to requestId,
            ),
        ) { data, erro ->
            val rawResult = data?.get("result")
            val resultText = when (rawResult) {
                is List<*> -> rawResult.joinToString("     ")
                is Map<*, *> -> rawResult["display"] as? String
                    ?: "${rawResult["number"]} · ${rawResult["color"]}"
                else -> ""
            }
            val resultado = data?.let {
                ResultadoJogo(
                    resultado = resultText,
                    variacaoCentavos = (it["deltaCents"] as? Number)?.toLong() ?: 0L,
                    saldoCentavos = (it["balanceCents"] as? Number)?.toLong() ?: 0L,
                    partidas = (it["gamesPlayed"] as? Number)?.toInt() ?: 0,
                    vitorias = (it["wins"] as? Number)?.toInt() ?: 0,
                    multiplicador = (it["payoutMultiplier"] as? Number)?.toInt() ?: 0,
                )
            }
            callback(resultado, erro)
        }
    }

    fun iniciarDesafioSolo(
        jogo: String,
        apostaCentavos: Long,
        requestId: String,
        callback: (String?, Exception?) -> Unit,
    ) {
        chamarFunction(
            "startSoloChallenge",
            mapOf("game" to jogo, "amountCents" to apostaCentavos, "requestId" to requestId),
        ) { data, erro ->
            callback(data?.get("seed") as? String, erro)
        }
    }

    fun iniciarCrash(apostaCentavos: Long, requestId: String, callback: (SessaoCrash?, Exception?) -> Unit) {
        chamarFunction("startCrash", mapOf("amountCents" to apostaCentavos, "requestId" to requestId)) { data, erro ->
            val sessao = data?.let {
                SessaoCrash(
                    gameId = it["gameId"] as? String ?: return@let null,
                    apostaCentavos = (it["amountCents"] as? Number)?.toLong() ?: apostaCentavos,
                    iniciadoEmMs = (it["startedAtMs"] as? Number)?.toLong() ?: 0L,
                    retomada = it["resumed"] as? Boolean ?: false,
                )
            }
            callback(sessao, erro)
        }
    }

    fun sacarCrash(gameId: String, requestId: String, callback: (ResultadoCrash?, Exception?) -> Unit) {
        chamarFunction("cashOutCrash", mapOf("gameId" to gameId, "requestId" to requestId)) { data, erro ->
            val resultado = data?.let {
                ResultadoCrash(
                    caiu = it["crashed"] as? Boolean ?: false,
                    multiplicadorBps = (it["multiplierBps"] as? Number)?.toInt() ?: 100,
                    premioCentavos = (it["payoutCents"] as? Number)?.toLong() ?: 0L,
                    lucroCentavos = (it["profitCents"] as? Number)?.toLong() ?: 0L,
                    saldoCentavos = (it["balanceCents"] as? Number)?.toLong() ?: 0L,
                    partidas = (it["gamesPlayed"] as? Number)?.toInt() ?: 0,
                    vitorias = (it["wins"] as? Number)?.toInt() ?: 0,
                )
            }
            callback(resultado, erro)
        }
    }

    fun iniciarMinas(
        apostaCentavos: Long,
        quantidadeMinas: Int,
        requestId: String,
        callback: (EstadoMinas?, Exception?) -> Unit,
    ) {
        chamarFunction(
            "startMines",
            mapOf("amountCents" to apostaCentavos, "mineCount" to quantidadeMinas, "requestId" to requestId),
        ) { data, erro -> callback(data?.toEstadoMinas(apostaCentavos, quantidadeMinas), erro) }
    }

    fun carregarMinasAtiva(callback: (EstadoMinas?, Exception?) -> Unit) {
        chamarFunction("getActiveMines", emptyMap()) { data, error ->
            val state = data?.takeIf { it["status"] == "active" }?.toEstadoMinas()
            callback(state, error)
        }
    }

    fun revelarCasaMinas(
        gameId: String,
        casa: Int,
        requestId: String,
        callback: (EstadoMinas?, Exception?) -> Unit,
    ) {
        chamarFunction(
            "revealMinesCell",
            mapOf("gameId" to gameId, "cell" to casa, "requestId" to requestId),
        ) { data, erro -> callback(data?.toEstadoMinas(), erro) }
    }

    fun sacarMinas(gameId: String, requestId: String, callback: (EstadoMinas?, Exception?) -> Unit) {
        chamarFunction("cashOutMines", mapOf("gameId" to gameId, "requestId" to requestId)) { data, erro ->
            callback(data?.toEstadoMinas(), erro)
        }
    }

    fun verificarAdmin(callback: (Boolean) -> Unit) {
        val usuario = auth.currentUser
        if (usuario == null) {
            callback(false)
            return
        }
        usuario.getIdToken(true)
            .addOnSuccessListener { callback(it.claims["admin"] == true) }
            .addOnFailureListener { callback(false) }
    }

    fun listarUsuariosAdmin(
        cursor: String,
        callback: (List<UsuarioAdmin>, String, Exception?) -> Unit,
    ) {
        chamarFunction("adminListUsers", mapOf("cursor" to cursor)) { data, error ->
            val users = (data?.get("users") as? List<*>)?.mapNotNull { raw ->
                val user = raw as? Map<*, *> ?: return@mapNotNull null
                val uid = user["uid"] as? String ?: return@mapNotNull null
                UsuarioAdmin(
                    uid = uid,
                    nome = user["displayName"] as? String ?: "Jogador",
                    username = user["username"] as? String ?: "",
                    email = user["email"] as? String ?: "",
                    saldoCentavos = (user["balanceCents"] as? Number)?.toLong() ?: 0L,
                    bloqueado = user["isBlocked"] as? Boolean ?: false,
                    avatarUrl = user["avatarUrl"] as? String ?: "",
                    avatarComoFotoPerfil = user["avatarAsProfilePhoto"] as? Boolean ?: false,
                    avatarItensEquipados = (user["equippedAvatarItems"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
                    molduraEquipada = user["equippedFrame"] as? String ?: "",
                )
            }.orEmpty()
            callback(users, data?.get("nextCursor") as? String ?: "", error)
        }
    }

    fun buscarResumoVisualLeaderboard(uid: String, callback: (UsuarioAdmin?) -> Unit) {
        database.collection("leaderboard").document(uid).get()
            .addOnSuccessListener { snapshot ->
                if (!snapshot.exists()) {
                    callback(null)
                    return@addOnSuccessListener
                }
                callback(
                    UsuarioAdmin(
                        uid = uid,
                        nome = snapshot.getString("displayName") ?: "Jogador",
                        username = snapshot.getString("username") ?: "",
                        email = "",
                        saldoCentavos = snapshot.getLong("balanceCents") ?: 0L,
                        bloqueado = false,
                        avatarUrl = snapshot.getString("avatarUrl") ?: "",
                        avatarComoFotoPerfil = snapshot.getBoolean("avatarAsProfilePhoto") == true,
                        avatarItensEquipados = (snapshot.get("equippedAvatarItems") as? List<*>)
                            ?.filterIsInstance<String>().orEmpty(),
                    ),
                )
            }
            .addOnFailureListener { callback(null) }
    }

    fun carregarDetalhesAdmin(uid: String, callback: (DetalhesAdmin?, Exception?) -> Unit) {
        chamarFunction("adminGetUserDetails", mapOf("uid" to uid)) { data, error ->
            val user = data?.get("user") as? Map<*, *>
            val detalhes = if (user == null) null else {
                val jogador = UsuarioAdmin(
                    uid = user["uid"] as? String ?: uid,
                    nome = user["displayName"] as? String ?: "Jogador",
                    username = user["username"] as? String ?: "",
                    email = user["email"] as? String ?: "",
                    saldoCentavos = (user["balanceCents"] as? Number)?.toLong() ?: 0L,
                    bloqueado = user["isBlocked"] as? Boolean ?: false,
                    avatarUrl = user["avatarUrl"] as? String ?: "",
                    avatarComoFotoPerfil = user["avatarAsProfilePhoto"] as? Boolean ?: false,
                    avatarItensEquipados = (user["equippedAvatarItems"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
                    molduraEquipada = user["equippedFrame"] as? String ?: "",
                )
                val transactions = (data["transactions"] as? List<*>)?.mapNotNull { raw ->
                    val transaction = raw as? Map<*, *> ?: return@mapNotNull null
                    MovimentoAdmin(
                        id = transaction["id"] as? String ?: "",
                        descricao = transaction["description"] as? String ?: "Movimentação",
                        deltaCentavos = (transaction["deltaCents"] as? Number)?.toLong() ?: 0L,
                        criadoEmMs = (transaction["createdAtMs"] as? Number)?.toLong() ?: 0L,
                    )
                }.orEmpty()
                DetalhesAdmin(
                    usuario = jogador,
                    partidas = (user["gamesPlayed"] as? Number)?.toInt() ?: 0,
                    vitorias = (user["wins"] as? Number)?.toInt() ?: 0,
                    movimentacoes = transactions,
                    inventario = (user["inventory"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
                )
            }
            callback(detalhes, error)
        }
    }

    fun carregarConfiguracaoMinas(callback: (ConfiguracaoMinas?, Exception?) -> Unit) {
        chamarFunction("getGameSettings", emptyMap()) { data, error ->
            val settings = data?.let {
                ConfiguracaoMinas(
                    rtpBps = (it["minesRtpBps"] as? Number)?.toInt() ?: 9_800,
                    minimoMinas = (it["minesMinCount"] as? Number)?.toInt() ?: 1,
                    maximoMinas = (it["minesMaxCount"] as? Number)?.toInt() ?: 24,
                )
            }
            callback(settings, error)
        }
    }

    fun carregarMissoes(callback: (EstadoMissoes?, Exception?) -> Unit) {
        chamarFunction("getMissions", emptyMap()) { data, error ->
            fun missao(nome: String): ProgressoMissao? {
                val raw = data?.get(nome) as? Map<*, *> ?: return null
                return ProgressoMissao(
                    periodo = raw["period"] as? String ?: "",
                    progresso = (raw["progress"] as? Number)?.toInt() ?: 0,
                    meta = (raw["target"] as? Number)?.toInt() ?: 0,
                    recompensaCentavos = (raw["rewardCents"] as? Number)?.toLong() ?: 0L,
                    concluida = raw["completed"] as? Boolean ?: false,
                )
            }
            val state = missao("daily")?.let { daily ->
                missao("weekly")?.let { weekly ->
                    missao("dailySports")?.let { dailySports -> EstadoMissoes(daily, weekly, dailySports) }
                }
            }
            callback(state, error)
        }
    }

    fun carregarPartidasEsportivas(callback: (List<PartidaEsportiva>, Exception?) -> Unit) {
        chamarFunction("listFootballMatches", emptyMap()) { data, error ->
            val matches = (data?.get("matches") as? List<*>)?.mapNotNull { raw ->
                val match = raw as? Map<*, *> ?: return@mapNotNull null
                val fixtureId = (match["fixtureId"] as? Number)?.toInt() ?: return@mapNotNull null
                PartidaEsportiva(
                    fixtureId = fixtureId,
                    kickoffMs = (match["kickoffMs"] as? Number)?.toLong() ?: 0L,
                    campeonato = match["league"] as? String ?: "Futebol",
                    mandante = match["homeTeam"] as? String ?: "Mandante",
                    visitante = match["awayTeam"] as? String ?: "Visitante",
                    oddMandanteBps = (match["homeOddsBps"] as? Number)?.toInt() ?: 0,
                    oddVisitanteBps = (match["awayOddsBps"] as? Number)?.toInt() ?: 0,
                    mercados = (match["markets"] as? List<*>)?.mapNotNull { optionRaw ->
                        val option = optionRaw as? Map<*, *> ?: return@mapNotNull null
                        val marketId = option["marketId"] as? String ?: return@mapNotNull null
                        val selectionId = option["selectionId"] as? String ?: return@mapNotNull null
                        OpcaoApostaEsportiva(
                            mercadoId = marketId,
                            mercadoNome = option["marketName"] as? String ?: "Mercado",
                            selecaoId = selectionId,
                            selecaoNome = option["selectionName"] as? String ?: selectionId,
                            linha = (option["line"] as? Number)?.toDouble(),
                            oddBps = (option["oddsBps"] as? Number)?.toInt() ?: 0,
                            bookmaker = option["bookmaker"] as? String ?: "",
                        )
                    }.orEmpty(),
                )
            }.orEmpty()
            callback(matches, error)
        }
    }

    fun listarApostasEsportivas(callback: (List<ApostaEsportiva>, Exception?) -> Unit) {
        chamarFunction("listMySportsBets", emptyMap()) { data, error ->
            val bets = (data?.get("bets") as? List<*>)?.mapNotNull { raw ->
                val bet = raw as? Map<*, *> ?: return@mapNotNull null
                val id = bet["id"] as? String ?: return@mapNotNull null
                val pernas = (bet["legs"] as? List<*>)?.mapNotNull { legRaw ->
                    val leg = legRaw as? Map<*, *> ?: return@mapNotNull null
                    val fixtureId = (leg["fixtureId"] as? Number)?.toInt() ?: return@mapNotNull null
                    PernaApostaEsportiva(
                        fixtureId = fixtureId,
                        campeonato = leg["league"] as? String ?: "Futebol",
                        mandante = leg["homeTeam"] as? String ?: "Mandante",
                        visitante = leg["awayTeam"] as? String ?: "Visitante",
                        kickoffMs = (leg["kickoffMs"] as? Number)?.toLong() ?: 0L,
                        mercadoId = leg["marketId"] as? String ?: "match_winner",
                        mercadoNome = leg["marketName"] as? String ?: "Resultado 1X2",
                        selecaoId = leg["selectionId"] as? String ?: "",
                        selecaoNome = leg["selectionName"] as? String ?: "Seleção",
                        linha = (leg["line"] as? Number)?.toDouble(),
                        oddBps = (leg["oddsBps"] as? Number)?.toInt() ?: 0,
                    )
                }.orEmpty()
                ApostaEsportiva(
                    id = id,
                    fixtureId = (bet["fixtureId"] as? Number)?.toInt() ?: 0,
                    campeonato = bet["league"] as? String ?: "Futebol",
                    mandante = bet["homeTeam"] as? String ?: "Mandante",
                    visitante = bet["awayTeam"] as? String ?: "Visitante",
                    kickoffMs = (bet["kickoffMs"] as? Number)?.toLong() ?: 0L,
                    selecao = bet["selection"] as? String ?: "",
                    nomeSelecao = bet["selectionName"] as? String ?: "",
                    oddBps = (bet["oddsBps"] as? Number)?.toInt() ?: 0,
                    valorCentavos = (bet["stakeCents"] as? Number)?.toLong() ?: 0L,
                    status = bet["status"] as? String ?: "open",
                    resultado = bet["result"] as? String ?: "",
                    premioCentavos = (bet["payoutCents"] as? Number)?.toLong() ?: 0L,
                    pernas = pernas.ifEmpty {
                        listOf(
                            PernaApostaEsportiva(
                                fixtureId = (bet["fixtureId"] as? Number)?.toInt() ?: 0,
                                campeonato = bet["league"] as? String ?: "Futebol",
                                mandante = bet["homeTeam"] as? String ?: "Mandante",
                                visitante = bet["awayTeam"] as? String ?: "Visitante",
                                kickoffMs = (bet["kickoffMs"] as? Number)?.toLong() ?: 0L,
                                mercadoId = bet["marketId"] as? String ?: "match_winner",
                                mercadoNome = "Resultado 1X2",
                                selecaoId = bet["selection"] as? String ?: "",
                                selecaoNome = bet["selectionName"] as? String ?: "Seleção",
                                linha = null,
                                oddBps = (bet["oddsBps"] as? Number)?.toInt() ?: 0,
                            ),
                        )
                    },
                )
            }.orEmpty()
            callback(bets, error)
        }
    }

    fun apostarPartidaEsportiva(
        pernas: List<PernaApostaEsportiva>,
        valorCentavos: Long,
        requestId: String,
        callback: (Exception?) -> Unit,
    ) {
        chamarFunction(
            "placeSportsBet",
            mapOf(
                "legs" to pernas.map { leg ->
                    mapOf(
                        "fixtureId" to leg.fixtureId,
                        "marketId" to leg.mercadoId,
                        "selectionId" to leg.selecaoId,
                        "expectedOddsBps" to leg.oddBps,
                    )
                },
                "amountCents" to valorCentavos,
                "requestId" to requestId,
            ),
        ) { _, error -> callback(error) }
    }

    fun liquidarApostasEsportivas(callback: (Int?, Exception?) -> Unit) {
        chamarFunction("settleMySportsBets", emptyMap()) { data, error ->
            callback((data?.get("settledCount") as? Number)?.toInt(), error)
        }
    }

    fun listarSalasCaboGuerra(callback: (List<SalaCaboGuerra>, Exception?) -> Unit) {
        chamarFunction("listTugRooms", emptyMap()) { data, error ->
            val rooms = (data?.get("rooms") as? List<*>)
                ?.mapNotNull { (it as? Map<*, *>)?.toSalaCaboGuerra() }
                .orEmpty()
            callback(rooms, error)
        }
    }

    fun carregarPredefinicoesSala(callback: (List<PredefinicaoSala>, Exception?) -> Unit) {
        chamarFunction("getTugRoomPresets", emptyMap()) { data, error ->
            if (data == null || error != null) {
                callback(emptyList(), error ?: IllegalStateException("Resposta de predefinições vazia."))
                return@chamarFunction
            }
            val values = (data["presets"] as? List<*>).orEmpty().mapNotNull { raw ->
                val item = raw as? Map<*, *> ?: return@mapNotNull null
                val name = item["name"] as? String ?: return@mapNotNull null
                val gameId = item["gameId"] as? String ?: return@mapNotNull null
                val mode = item["mode"] as? String ?: return@mapNotNull null
                val stake = (item["stakeCents"] as? Number)?.toLong() ?: return@mapNotNull null
                PredefinicaoSala(name, mode, gameId, stake)
            }
            callback(values, null)
        }
    }

    fun carregarMensagensSala(
        roomId: String,
        callback: (List<MensagemSalaJogo>, Exception?) -> Unit,
    ) {
        chamarFunction("getTugRoomMessages", mapOf("roomId" to roomId)) { data, error ->
            val messages = (data?.get("messages") as? List<*>).orEmpty().mapNotNull { raw ->
                val item = raw as? Map<*, *> ?: return@mapNotNull null
                MensagemSalaJogo(
                    id = item["id"] as? String ?: return@mapNotNull null,
                    uid = item["senderUid"] as? String ?: "",
                    nome = item["senderName"] as? String ?: "Jogador",
                    texto = item["text"] as? String ?: "",
                    rapida = item["quickMessage"] as? Boolean ?: false,
                    enviadaEmMs = (item["createdAtMs"] as? Number)?.toLong() ?: 0L,
                )
            }
            callback(messages, error)
        }
    }

    fun enviarMensagemSala(
        roomId: String,
        text: String,
        quickMessageId: String,
        requestId: String,
        callback: (Exception?) -> Unit,
    ) {
        chamarFunction(
            "sendTugRoomMessage",
            mapOf(
                "roomId" to roomId,
                "text" to text,
                "quickMessageId" to quickMessageId,
                "requestId" to requestId,
            ),
        ) { _, error -> callback(error) }
    }

    fun salvarPredefinicoesSala(
        presets: List<PredefinicaoSala>,
        callback: (Exception?) -> Unit,
    ) {
        chamarFunction(
            "saveTugRoomPresets",
            mapOf(
                "presets" to presets.map { preset ->
                    mapOf(
                        "name" to preset.nome,
                        "mode" to preset.modo,
                        "gameId" to preset.gameId,
                        "stakeCents" to preset.apostaCentavos,
                    )
                },
            ),
        ) { _, error -> callback(error) }
    }

    fun criarSalaCaboGuerra(
        apostaCentavos: Long,
        convitesUids: List<String>,
        senha: String,
        modo: String,
        gameId: String,
        clanId: String,
        requestId: String,
        callback: (SalaCaboGuerra?, Exception?) -> Unit,
    ) {
        chamarFunction(
            "createTugRoom",
            mapOf(
                "stakeCents" to apostaCentavos,
                "invitedUids" to convitesUids,
                "password" to senha,
                "mode" to modo,
                "gameId" to gameId,
                "clanId" to clanId,
                "requestId" to requestId,
            ),
        ) { data, error -> callback(data?.toSalaCaboGuerra(), error) }
    }

    fun entrarSalaCaboGuerra(
        roomId: String,
        senha: String,
        requestId: String,
        callback: (SalaCaboGuerra?, Exception?) -> Unit,
    ) {
        chamarFunction("joinTugRoom", mapOf("roomId" to roomId, "password" to senha, "requestId" to requestId)) { data, error ->
            callback(data?.toSalaCaboGuerra(), error)
        }
    }

    fun gerenciarSalaCaboGuerra(
        roomId: String,
        acao: String,
        requestId: String,
        targetUid: String = "",
        apostaCentavos: Long = 0L,
        senha: String = "",
        callback: (SalaCaboGuerra?, Exception?) -> Unit,
    ) {
        val values = mutableMapOf<String, Any>("roomId" to roomId, "action" to acao, "requestId" to requestId)
        if (targetUid.isNotBlank()) values["targetUid"] = targetUid
        if (apostaCentavos > 0L) values["stakeCents"] = apostaCentavos
        if (acao == "setPassword") values["password"] = senha
        chamarFunction("manageTugRoom", values) { data, error ->
            callback((data?.get("room") as? Map<*, *>)?.toSalaCaboGuerra(), error)
        }
    }

    fun iniciarSalaCaboGuerra(roomId: String, callback: (SalaCaboGuerra?, Exception?) -> Unit) {
        chamarFunction("startTugRoom", mapOf("roomId" to roomId)) { data, error ->
            callback(data?.toSalaCaboGuerra(), error)
        }
    }

    fun puxarCordaCaboGuerra(roomId: String, pullCount: Int, requestId: String, callback: (SalaCaboGuerra?, Exception?) -> Unit) {
        chamarFunction("pullTugRope", mapOf("roomId" to roomId, "pullCount" to pullCount, "requestId" to requestId)) { data, error ->
            callback(data?.toSalaCaboGuerra(), error)
        }
    }

    fun atualizarConfiguracaoMinasAdmin(
        configuracao: ConfiguracaoMinas,
        motivo: String,
        requestId: String,
        callback: (Exception?) -> Unit,
    ) {
        chamarFunction(
            "adminUpdateGameSettings",
            mapOf(
                "minesRtpBps" to configuracao.rtpBps,
                "minesMinCount" to configuracao.minimoMinas,
                "minesMaxCount" to configuracao.maximoMinas,
                "reason" to motivo,
                "requestId" to requestId,
            ),
        ) { _, error -> callback(error) }
    }

    fun ajustarSaldoAdmin(
        uid: String,
        deltaCentavos: Long,
        motivo: String,
        requestId: String,
        callback: (Long?, Exception?) -> Unit,
    ) {
        chamarFunction(
            "adminAdjustBalance",
            mapOf("uid" to uid, "deltaCents" to deltaCentavos, "reason" to motivo, "requestId" to requestId),
        ) { data, error -> callback((data?.get("balanceCents") as? Number)?.toLong(), error) }
    }

    fun atualizarInventarioAdmin(
        uid: String,
        acao: String,
        itemId: String,
        motivo: String,
        requestId: String,
        callback: (Exception?) -> Unit,
    ) {
        chamarFunction(
            "adminUpdateUserInventory",
            mapOf(
                "uid" to uid,
                "action" to acao,
                "itemId" to itemId,
                "reason" to motivo,
                "requestId" to requestId,
            ),
        ) { _, error -> callback(error) }
    }

    fun definirBloqueioAdmin(
        uid: String,
        bloqueado: Boolean,
        motivo: String,
        requestId: String,
        callback: (Exception?) -> Unit,
    ) {
        chamarFunction(
            "adminSetUserBlocked",
            mapOf("uid" to uid, "blocked" to bloqueado, "reason" to motivo, "requestId" to requestId),
        ) { _, error -> callback(error) }
    }

    fun excluirUsuarioAdmin(
        uid: String,
        confirmUid: String,
        motivo: String,
        requestId: String,
        callback: (Exception?) -> Unit,
    ) {
        chamarFunction(
            "adminDeleteUser",
            mapOf("uid" to uid, "confirmUid" to confirmUid, "reason" to motivo, "requestId" to requestId),
        ) { _, error -> callback(error) }
    }

    fun iniciarBlackjack(apostaCentavos: Long, requestId: String, callback: (EstadoBlackjack?, Exception?) -> Unit) {
        chamarFunction("startBlackjack", mapOf("amountCents" to apostaCentavos, "requestId" to requestId)) { data, erro ->
            callback(data?.toEstadoBlackjack(), erro)
        }
    }

    fun acaoBlackjack(
        gameId: String,
        acao: String,
        requestId: String,
        callback: (EstadoBlackjack?, Exception?) -> Unit,
    ) {
        chamarFunction(
            "blackjackAction",
            mapOf("gameId" to gameId, "action" to acao, "requestId" to requestId),
        ) { data, erro -> callback(data?.toEstadoBlackjack(), erro) }
    }

    fun comprarCosmetico(itemId: String, callback: (String?) -> Unit) {
        if (itemId.isBlank()) {
            callback("Este item não está disponível.")
            return
        }
        chamarFunction("buyCosmetic", mapOf("itemId" to itemId)) { _, error ->
            callback(error?.localizedMessage)
        }
    }

    fun carregarRecursosSociais(callback: (ResultadoRecursosSociais?, Exception?) -> Unit) {
        chamarFunction("getSocialDashboard", emptyMap()) { data, erro ->
            if (erro != null || data == null) {
                callback(null, erro ?: IllegalStateException("Resposta social vazia."))
                return@chamarFunction
            }
            callback(data.toResultadoRecursosSociais(), null)
        }
    }

    fun carregarPainelConta(callback: (PainelConta?, Exception?) -> Unit) {
        chamarFunction("getAccountSettings", emptyMap()) { data, error ->
            if (data == null || error != null) {
                callback(null, error ?: IllegalStateException("Resposta de configurações vazia."))
                return@chamarFunction
            }
            val settings = data["settings"] as? Map<*, *> ?: emptyMap<Any, Any>()
            fun accountList(key: String): List<AmigoConta> =
                (data[key] as? List<*>).orEmpty().mapNotNull { raw ->
                    val item = raw as? Map<*, *> ?: return@mapNotNull null
                    val uid = item["uid"] as? String ?: return@mapNotNull null
                    AmigoConta(
                        uid = uid,
                        nome = item["displayName"] as? String ?: "Jogador",
                        username = item["username"] as? String ?: "",
                        status = item["status"] as? String ?: "",
                        online = item["online"] as? Boolean ?: false,
                    )
                }
            val activity = (data["activity"] as? List<*>).orEmpty().mapNotNull { raw ->
                val item = raw as? Map<*, *> ?: return@mapNotNull null
                AlteracaoConta(
                    id = item["id"] as? String ?: return@mapNotNull null,
                    fields = (item["fields"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
                    createdAtMs = (item["createdAtMs"] as? Number)?.toLong() ?: 0L,
                )
            }
            val announcements = (data["announcements"] as? List<*>).orEmpty().mapNotNull { raw ->
                val item = raw as? Map<*, *> ?: return@mapNotNull null
                AvisoApp(
                    id = item["id"] as? String ?: return@mapNotNull null,
                    title = item["title"] as? String ?: "Aviso",
                    details = item["details"] as? String ?: "",
                    type = item["type"] as? String ?: "news",
                    expiresAtMs = (item["expiresAtMs"] as? Number)?.toLong() ?: 0L,
                )
            }
            val recommendations = (data["recommendations"] as? List<*>).orEmpty().mapNotNull { raw ->
                val item = raw as? Map<*, *> ?: return@mapNotNull null
                RecomendacaoJogo(
                    gameId = item["gameId"] as? String ?: return@mapNotNull null,
                    played = (item["played"] as? Number)?.toInt() ?: 0,
                    wins = (item["wins"] as? Number)?.toInt() ?: 0,
                )
            }
            callback(
                PainelConta(
                    preferences = PreferenciasConta(
                        profileVisibility = settings["profileVisibility"] as? String ?: "public",
                        customStatus = settings["customStatus"] as? String ?: "",
                        theme = settings["theme"] as? String ?: "dark",
                        locale = settings["locale"] as? String ?: "pt-BR",
                        accessibilityFontScale = (settings["accessibilityFontScale"] as? Number)?.toDouble() ?: 1.0,
                        highContrast = settings["highContrast"] as? Boolean ?: false,
                        reduceMotion = settings["reduceMotion"] as? Boolean ?: false,
                        confirmImportant = settings["confirmImportant"] as? Boolean ?: true,
                        personalizedRecommendations = settings["personalizedRecommendations"] as? Boolean ?: true,
                        syncSettings = settings["syncSettings"] as? Boolean ?: true,
                    ),
                    friends = accountList("friends"),
                    friendRequests = accountList("friendRequests"),
                    activity = activity,
                    announcements = announcements,
                    recommendations = recommendations,
                    whatsappLink = (data["whatsappLink"] as? Map<*, *>)?.let { link ->
                        VinculoWhatsAppConta(
                            linked = link["linked"] as? Boolean ?: false,
                            linkedAtMs = (link["linkedAtMs"] as? Number)?.toLong() ?: 0L,
                        )
                    } ?: VinculoWhatsAppConta(),
                ),
                null,
            )
        }
    }

    fun criarCodigoVinculoWhatsApp(callback: (String?, Long, Exception?) -> Unit) {
        chamarFunction("createWhatsAppLinkCode", emptyMap()) { data, error ->
            callback(
                data?.get("code") as? String,
                (data?.get("expiresAtMs") as? Number)?.toLong() ?: 0L,
                error ?: if (data?.get("code") is String) null else IllegalStateException("Código de vínculo não recebido."),
            )
        }
    }

    fun desvincularWhatsApp(callback: (Exception?) -> Unit) {
        chamarFunction("unlinkWhatsAppAccount", emptyMap()) { _, error -> callback(error) }
    }

    fun carregarEconomiaWhatsApp(callback: (EconomiaWhatsApp?, Exception?) -> Unit) {
        chamarFunction("getLinkedWhatsAppEconomy", emptyMap()) { data, error ->
            if (error != null || data == null) {
                callback(null, error ?: IllegalStateException("Resposta da economia do WhatsApp vazia."))
                return@chamarFunction
            }
            val groups = (data["groups"] as? List<*>).orEmpty().mapNotNull { raw ->
                val group = raw as? Map<*, *> ?: return@mapNotNull null
                val name = group["name"] as? String ?: return@mapNotNull null
                GrupoEconomiaWhatsApp(
                    name = name,
                    gold = (group["gold"] as? Number)?.toLong() ?: 0L,
                    bankGold = (group["bankGold"] as? Number)?.toLong() ?: 0L,
                )
            }
            val history = (data["history"] as? List<*>).orEmpty().mapNotNull { raw ->
                val entry = raw as? Map<*, *> ?: return@mapNotNull null
                HistoricoGoldWhatsApp(
                    groupName = entry["groupName"] as? String ?: return@mapNotNull null,
                    type = entry["type"] as? String ?: return@mapNotNull null,
                    item = entry["item"] as? String ?: "Movimentação",
                    amount = (entry["amount"] as? Number)?.toLong() ?: 0L,
                    createdAtMs = (entry["createdAtMs"] as? Number)?.toLong() ?: 0L,
                )
            }
            val totalGold = (data["totalGold"] as? Number)?.toLong()
            val totalBankGold = (data["totalBankGold"] as? Number)?.toLong()
            if (totalGold == null || totalBankGold == null) {
                callback(null, IllegalStateException("Resposta da economia do WhatsApp inválida."))
                return@chamarFunction
            }
            callback(EconomiaWhatsApp(totalGold, totalBankGold, groups, history), null)
        }
    }

    fun salvarPreferenciasConta(preferences: PreferenciasConta, callback: (Exception?) -> Unit) {
        chamarFunction("saveAccountSettings", mapOf("settings" to preferences.paraMapa())) { _, error ->
            callback(error)
        }
    }

    fun gerenciarAmigo(action: String, username: String = "", targetUid: String = "", callback: (Exception?) -> Unit) {
        chamarFunction(
            "manageFriend",
            mapOf("action" to action, "username" to username, "targetUid" to targetUid),
        ) { _, error -> callback(error) }
    }

    fun publicarAvisoApp(title: String, details: String, type: String, expiresAtMs: Long, callback: (Exception?) -> Unit) {
        chamarFunction(
            "publishAppAnnouncement",
            mapOf("title" to title, "details" to details, "type" to type, "expiresAtMs" to expiresAtMs),
        ) { _, error -> callback(error) }
    }

    fun enviarSolicitacaoSuporte(title: String, details: String, category: String, callback: (Exception?) -> Unit) {
        chamarFunction(
            "createSupportTicket",
            mapOf("title" to title, "details" to details, "category" to category),
        ) { _, error -> callback(error) }
    }

    fun carregarSolicitacoesSuporteAdmin(callback: (List<Map<String, Any>>, Exception?) -> Unit) {
        chamarFunction("adminListSupportTickets", emptyMap()) { data, error ->
            val tickets = (data?.get("tickets") as? List<*>).orEmpty().mapNotNull { it as? Map<*, *> }
                .mapNotNull { item ->
                    val id = item["id"] as? String ?: return@mapNotNull null
                    item.entries.mapNotNull { (key, value) ->
                        val stringKey = key as? String ?: return@mapNotNull null
                        value?.let { stringKey to it }
                    }.toMap().plus("id" to id)
                }
            callback(tickets, error)
        }
    }

    fun criarCla(rascunho: RascunhoCla, callback: (Exception?) -> Unit) {
        executarAcaoSocial(
            "createSocialClan",
            mapOf(
                "name" to rascunho.nome,
                "description" to rascunho.descricao,
                "requestId" to UUID.randomUUID().toString(),
                "policy" to when (rascunho.politica) {
                    PoliticaCla.PUBLICO -> "public"
                    PoliticaCla.CONVITE -> "private"
                    PoliticaCla.APROVACAO -> "approval"
                },
            ),
            callback,
        )
    }

    fun entrarCla(clanId: String, callback: (Exception?) -> Unit) =
        executarAcaoSocial("joinSocialClan", mapOf("clanId" to clanId), callback)

    fun solicitarEntradaCla(clanId: String, callback: (Exception?) -> Unit) =
        executarAcaoSocial("requestSocialClanJoin", mapOf("clanId" to clanId), callback)

    fun entrarComConvite(codigo: String, callback: (Exception?) -> Unit) =
        executarAcaoSocial("joinSocialClanByInvite", mapOf("code" to codigo), callback)

    fun aceitarConviteCla(clanId: String, callback: (Exception?) -> Unit) =
        executarAcaoSocial("acceptSocialClanInvite", mapOf("clanId" to clanId), callback)

    fun sairCla(clanId: String, callback: (Exception?) -> Unit) =
        executarAcaoSocial("leaveSocialClan", mapOf("clanId" to clanId), callback)

    fun convidarUsuario(clanId: String, usuarioId: String, callback: (Exception?) -> Unit) =
        executarAcaoSocial(
            "inviteSocialClanMember",
            mapOf("clanId" to clanId, "targetUid" to usuarioId),
            callback,
        )

    fun aprovarSolicitacaoCla(clanId: String, usuarioId: String, callback: (Exception?) -> Unit) =
        executarAcaoSocial(
            "approveSocialClanRequest",
            mapOf("clanId" to clanId, "targetUid" to usuarioId, "approve" to true),
            callback,
        )

    fun removerMembroCla(clanId: String, usuarioId: String, callback: (Exception?) -> Unit) =
        executarAcaoSocial(
            "removeSocialClanMember",
            mapOf("clanId" to clanId, "targetUid" to usuarioId),
            callback,
        )

    fun resgatarRecompensaSemanal(eventId: String, callback: (Exception?) -> Unit) =
        executarAcaoSocial("claimWeeklyEventReward", mapOf("eventId" to eventId), callback)

    fun enviarDenuncia(denuncia: DenunciaSocial, callback: (Exception?) -> Unit) {
        val categoria = when (denuncia.categoria) {
            CategoriaDenuncia.ASSÉDIO -> "harassment"
            CategoriaDenuncia.TRAPAÇA -> "cheating"
            CategoriaDenuncia.SPAM -> "spam"
            CategoriaDenuncia.CONTEUDO -> "inappropriate_content"
            CategoriaDenuncia.OUTRO -> "other"
        }
        executarAcaoSocial(
            "submitPlayerReport",
            mapOf(
                "targetUid" to denuncia.usuarioAlvoId.orEmpty(),
                "category" to categoria,
                "details" to denuncia.detalhes,
                "requestId" to UUID.randomUUID().toString(),
            ),
            callback,
        )
    }

    fun listarDenunciasAdmin(callback: (List<DenunciaModeracao>, Exception?) -> Unit) {
        chamarFunction("adminListPlayerReports", emptyMap()) { data, erro ->
            if (erro != null || data == null) {
                callback(emptyList(), erro ?: IllegalStateException("Resposta de moderação vazia."))
                return@chamarFunction
            }
            val reports = (data["reports"] as? List<*>).orEmpty().mapNotNull { item ->
                val report = item as? Map<*, *> ?: return@mapNotNull null
                DenunciaModeracao(
                    id = report["id"] as? String ?: return@mapNotNull null,
                    denunciante = report["reporterName"] as? String ?: "Jogador",
                    usuarioAlvoId = report["targetUid"] as? String ?: "",
                    usuarioAlvo = report["targetName"] as? String ?: "Jogador",
                    categoria = report["category"] as? String ?: "other",
                    detalhes = report["details"] as? String ?: "",
                    status = report["status"] as? String ?: "open",
                )
            }
            callback(reports, null)
        }
    }

    fun moderarDenuncia(
        reportId: String,
        status: String,
        bloquearAlvo: Boolean,
        motivo: String,
        callback: (Exception?) -> Unit,
    ) = executarAcaoSocial(
        "adminModeratePlayerReport",
        mapOf(
            "reportId" to reportId,
            "status" to status,
            "blockTarget" to bloquearAlvo,
            "reason" to motivo,
        ),
        callback,
    )

    private fun executarAcaoSocial(
        functionName: String,
        data: Map<String, Any>,
        callback: (Exception?) -> Unit,
    ) {
        chamarFunction(functionName, data) { _, error -> callback(error) }
    }

    private fun Map<String, Any>.toResultadoRecursosSociais(): ResultadoRecursosSociais {
        fun objectMap(value: Any?): Map<*, *> = value as? Map<*, *> ?: emptyMap<Any, Any>()
        fun string(value: Any?, fallback: String = ""): String = value as? String ?: fallback
        fun integer(value: Any?): Int = (value as? Number)?.toInt() ?: 0
        val clans = (this["clans"] as? List<*>).orEmpty().mapNotNull { value ->
            val clan = value as? Map<*, *> ?: return@mapNotNull null
            val policy = when (string(clan["policy"])) {
                "private" -> PoliticaCla.CONVITE
                "approval" -> PoliticaCla.APROVACAO
                else -> PoliticaCla.PUBLICO
            }
            val members = (clan["members"] as? List<*>).orEmpty().mapNotNull { memberValue ->
                val member = memberValue as? Map<*, *> ?: return@mapNotNull null
                val memberId = string(member["userId"])
                if (memberId.isBlank()) return@mapNotNull null
                MembroClã(
                    userId = memberId,
                    nome = string(member["name"], "Jogador"),
                    isLider = member["isLeader"] == true,
                    pontuacaoSemanal = integer(member["weeklyScore"]),
                )
            }
            val pending = (clan["pendingRequests"] as? List<*>).orEmpty().mapNotNull { pendingValue ->
                val pendingMember = pendingValue as? Map<*, *> ?: return@mapNotNull null
                val pendingId = string(pendingMember["userId"])
                if (pendingId.isBlank()) return@mapNotNull null
                MembroClã(pendingId, string(pendingMember["name"], "Jogador"))
            }
            val clanId = string(clan["id"])
            if (clanId.isBlank()) return@mapNotNull null
            ClaSocial(
                id = clanId,
                nome = string(clan["name"], "Clã"),
                descricao = string(clan["description"]),
                politica = policy,
                membros = members,
                liderId = string(clan["leaderId"]),
                codigoConvite = string(clan["inviteCode"]).ifBlank { null },
                solicitacoesPendentes = pending,
                pontuacaoSemanal = integer(clan["weeklyScore"]),
            )
        }
        val ranking = (this["clanRanking"] as? List<*>).orEmpty().mapNotNull { value ->
            val entry = value as? Map<*, *> ?: return@mapNotNull null
            EntradaRankingCla(
                posicao = integer(entry["position"]),
                claId = string(entry["clanId"]),
                nomeCla = string(entry["name"], "Clã"),
                pontuacao = integer(entry["score"]),
            )
        }
        val invitations = (this["clanInvitations"] as? List<*>).orEmpty().mapNotNull { value ->
            val invitation = value as? Map<*, *> ?: return@mapNotNull null
            val id = string(invitation["clanId"])
            if (id.isBlank()) return@mapNotNull null
            ConviteClaSocial(
                clanId = id,
                nomeCla = string(invitation["clanName"], "Clã"),
                convidadoPor = string(invitation["invitedBy"]),
            )
        }
        val event = objectMap(this["event"]).takeIf { it.isNotEmpty() }?.let { value ->
            EventoSemanal(
                id = string(value["id"]),
                tema = string(value["title"], "Semana de jogos"),
                descricao = string(value["description"]),
                progresso = integer(value["progress"]),
                meta = integer(value["target"]).coerceAtLeast(1),
                recompensa = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("pt-BR"))
                    .format(BigDecimal.valueOf(integer(value["rewardCents"]).toLong(), 2)),
                recompensaResgatada = value["claimed"] == true,
            )
        }
        val achievements = (this["achievements"] as? List<*>).orEmpty().mapNotNull { value ->
            val achievement = value as? Map<*, *> ?: return@mapNotNull null
            val id = string(achievement["id"])
            if (id.isBlank()) return@mapNotNull null
            val title = when (id) {
                "first_game" -> "Primeira partida"
                "games_played_10" -> "Veterano"
                "games_played_100" -> "Lenda dos jogos"
                "first_win" -> "Primeira vitória"
                "games_won_10" -> "Vencedor"
                "games_won_100" -> "Campeão"
                else -> id
            }
            val target = integer(achievement["target"])
            ConquistaSocial(
                id = id,
                nome = title,
                descricao = "Progresso: ${integer(achievement["progress"])} de $target",
                simbolo = if (achievement["unlocked"] == true) "★" else "☆",
                desbloqueada = achievement["unlocked"] == true,
                progresso = integer(achievement["progress"]),
                meta = target,
            )
        }
        val history = (this["history"] as? List<*>).orEmpty().mapNotNull { value ->
            val item = value as? Map<*, *> ?: return@mapNotNull null
            val id = string(item["id"])
            if (id.isBlank()) return@mapNotNull null
            val time = (item["atMs"] as? Number)?.toLong() ?: 0L
            PartidaHistoricoSocial(
                id = id,
                nomeJogo = string(item["gameName"], "Minijogo"),
                resultado = when (string(item["outcome"])) {
                    "won" -> "Vitória"
                    "lost" -> "Derrota"
                    else -> "Empate"
                },
                resumo = string(item["summary"]),
                data = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.forLanguageTag("pt-BR")).format(Date(time)),
            )
        }
        val stats = (this["stats"] as? List<*>).orEmpty().mapNotNull { value ->
            val item = value as? Map<*, *> ?: return@mapNotNull null
            val gameId = string(item["gameId"])
            if (gameId.isBlank()) return@mapNotNull null
            EstatisticaJogoSocial(
                nomeJogo = string(item["gameName"], gameId),
                partidas = integer(item["played"]),
                vitorias = integer(item["wins"]),
                derrotas = integer(item["losses"]),
                sequenciaAtual = integer(item["currentStreak"]),
            )
        }
        val reportUpdates = (this["reportUpdates"] as? List<*>).orEmpty().mapNotNull { value ->
            val item = value as? Map<*, *> ?: return@mapNotNull null
            val id = string(item["id"])
            if (id.isBlank()) return@mapNotNull null
            AtualizacaoDenuncia(
                id = id,
                categoria = string(item["category"], "other"),
                status = string(item["status"], "open"),
                motivo = string(item["reviewReason"]),
                criadaEmMs = (item["createdAtMs"] as? Number)?.toLong() ?: 0L,
            )
        }
        return ResultadoRecursosSociais(
            clas = clans,
            convites = invitations,
            atualizacoesDenuncias = reportUpdates,
            claAtualId = string(this["currentClanId"]).ifBlank { null },
            rankingClas = ranking,
            eventoSemanal = event,
            conquistas = achievements,
            historico = history,
            estatisticasPorJogo = stats,
        )
    }

    fun equiparMoldura(itemId: String, callback: (Exception?) -> Unit) {
        chamarFunction("equipFrame", mapOf("itemId" to itemId)) { _, erro -> callback(erro) }
    }

    fun sair() = auth.signOut()

    private fun chamarFunction(
        nome: String,
        dados: Map<String, Any>,
        callback: (Map<String, Any>?, Exception?) -> Unit,
    ) {
        val callbackConcluido = java.util.concurrent.atomic.AtomicBoolean(false)
        val timeout = Runnable {
            if (callbackConcluido.compareAndSet(false, true)) {
                callback(
                    null,
                    IllegalStateException(
                        "A solicitação demorou para confirmar. Confira seu saldo e coleção antes de tentar novamente.",
                    ),
                )
            }
        }
        principal.postDelayed(timeout, REQUEST_TIMEOUT_MS)
        fun concluir(data: Map<String, Any>?, error: Exception?) {
            if (callbackConcluido.compareAndSet(false, true)) {
                principal.removeCallbacks(timeout)
                callback(data, error)
            }
        }

        val usuario = auth.currentUser
        if (usuario == null) {
            concluir(null, IllegalStateException("Entre na sua conta para continuar."))
            return
        }
        usuario.getIdToken(false)
            .addOnSuccessListener { tokenResult ->
                if (callbackConcluido.get()) return@addOnSuccessListener
                Thread {
                    var dadosRetorno: Map<String, Any>? = null
                    var erroRetorno: Exception? = null
                    try {
                        dadosRetorno = postarNoServidor(nome, dados, tokenResult.token.orEmpty())
                    } catch (e: java.net.SocketTimeoutException) {
                        erroRetorno = IllegalStateException(
                            "O servidor demorou para responder. Tente de novo.", e,
                        )
                    } catch (e: java.io.IOException) {
                        erroRetorno = IllegalStateException(
                            "Não foi possível conectar ao servidor. Tente de novo em instantes.", e,
                        )
                    } catch (e: Exception) {
                        erroRetorno = e
                    }
                    principal.post { concluir(dadosRetorno, erroRetorno) }
                }.start()
            }
            .addOnFailureListener { erro -> concluir(null, erroParaUsuario(erro)) }
    }

    private fun postarNoServidor(nome: String, dados: Map<String, Any>, token: String): Map<String, Any>? {
        val conexao = java.net.URL("$SERVER_URL/call/$nome").openConnection() as java.net.HttpURLConnection
        try {
            conexao.requestMethod = "POST"
            conexao.connectTimeout = 15_000
            conexao.readTimeout = 85_000
            conexao.doOutput = true
            conexao.setRequestProperty("Content-Type", "application/json")
            conexao.setRequestProperty("Authorization", "Bearer $token")
            val corpo = org.json.JSONObject().put("data", org.json.JSONObject(dados)).toString()
            conexao.outputStream.use { it.write(corpo.toByteArray()) }

            val status = conexao.responseCode
            val fluxo = if (status in 200..299) conexao.inputStream else conexao.errorStream
            val texto = fluxo?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { org.json.JSONObject(texto) }.getOrNull()

            if (status !in 200..299) {
                val mensagem = json?.optJSONObject("error")?.optString("message").orEmpty()
                if (status == 404 && (mensagem.contains("função não encontrada", ignoreCase = true)
                        || mensagem.contains("function not found", ignoreCase = true))) {
                    throw IllegalStateException(
                        "O backend hospedado em zeca-jvic.onrender.com está desatualizado. Publique a versão atual da pasta functions/ no serviço.",
                    )
                }
                throw IllegalStateException(mensagem.ifBlank { "Erro no servidor ($status)." })
            }
            @Suppress("UNCHECKED_CAST")
            return paraValor(json?.opt("result")) as? Map<String, Any>
        } finally {
            conexao.disconnect()
        }
    }

    private fun paraValor(valor: Any?): Any? = when (valor) {
        null, org.json.JSONObject.NULL -> null
        is org.json.JSONObject -> {
            val mapa = HashMap<String, Any>()
            valor.keys().forEach { chave -> paraValor(valor.get(chave))?.let { mapa[chave] = it } }
            mapa
        }
        is org.json.JSONArray -> (0 until valor.length()).map { paraValor(valor.get(it)) }
        else -> valor
    }

    private fun erroParaUsuario(erro: Exception): Exception {
        if (erro is FirebaseFirestoreException && erro.code == FirebaseFirestoreException.Code.PERMISSION_DENIED) {
            return IllegalStateException(
                "O Firestore bloqueou a gravação. Publique as regras atualizadas do arquivo firestore.rules.",
                erro,
            )
        }
        if (erro !is FirebaseFunctionsException || erro.code != FirebaseFunctionsException.Code.NOT_FOUND) {
            return erro
        }
        val detalhe = erro.message.orEmpty()
        if (detalhe.equals("NOT_FOUND", ignoreCase = true)
            || detalhe.contains("no function", ignoreCase = true)
            || detalhe.contains("function not found", ignoreCase = true)) {
            return IllegalStateException(
                "O backend hospedado em zeca-jvic.onrender.com não encontrou este serviço. Publique a versão atual da pasta functions/ no serviço.",
                erro,
            )
        }
        return erro
    }

    private fun erroParaPerfilServidor(erro: Exception): Exception {
        val erroAmigavel = erroParaUsuario(erro)
        if (erroAmigavel.localizedMessage != "Erro interno.") return erroAmigavel
        return IllegalStateException(
            "O perfil foi carregado, mas a sincronização do servidor falhou. Confira FIREBASE_SERVICE_ACCOUNT e os Logs do Render.",
            erro,
        )
    }

    private fun toPerfil(snapshot: DocumentSnapshot): PerfilJogador = PerfilJogador(
        uid = snapshot.id,
        apelido = snapshot.getString("displayName") ?: "Jogador",
        email = snapshot.getString("email") ?: "",
        username = snapshot.getString("username") ?: "",
        profileSetupComplete = snapshot.getBoolean("profileSetupComplete") == true,
        saldoCentavos = snapshot.getLong("balanceCents") ?: 0L,
        nivel = snapshot.getLong("level")?.toInt() ?: 1,
        avatarUrl = snapshot.getString("avatarUrl") ?: "",
        chavePix = snapshot.getString("pixKey") ?: "",
        tipoChavePix = snapshot.getString("pixKeyType") ?: "",
        partidas = snapshot.getLong("gamesPlayed")?.toInt() ?: 0,
        vitorias = snapshot.getLong("wins")?.toInt() ?: 0,
        inventario = (snapshot.get("inventory") as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
        ganhoTotalCentavos = snapshot.getLong("totalWonCents") ?: 0L,
        perdaTotalCentavos = snapshot.getLong("totalLostCents") ?: 0L,
        molduraEquipada = snapshot.getString("equippedFrame") ?: "",
        avatarItensEquipados = (snapshot.get("equippedAvatarItems") as? List<*>)?.filterIsInstance<String>().orEmpty(),
        avatarComoFotoPerfil = snapshot.getBoolean("avatarAsProfilePhoto") == true,
        tituloEquipado = snapshot.getString("equippedTitle") ?: "",
        bio = snapshot.getString("bio") ?: "",
        clanId = snapshot.getString("clanId") ?: "",
    )

    private fun toJogadorRanking(snapshot: DocumentSnapshot): JogadorRanking? {
        val data = snapshot.data ?: return null
        return JogadorRanking(
            uid = snapshot.id,
            apelido = data["displayName"] as? String ?: "Jogador",
            saldoCentavos = (data["balanceCents"] as? Number)?.toLong() ?: 0L,
            nivel = (data["level"] as? Number)?.toInt() ?: 1,
            avatarUrl = data["avatarUrl"] as? String ?: "",
            username = data["username"] as? String ?: "",
            avatarItensEquipados = (data["equippedAvatarItems"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
            avatarComoFotoPerfil = data["avatarAsProfilePhoto"] as? Boolean ?: false,
            molduraEquipada = data["equippedFrame"] as? String ?: "",
        )
    }

    private fun Map<String, Any>.toEstadoBlackjack(): EstadoBlackjack? {
        val gameId = this["gameId"] as? String ?: return null
        fun cards(key: String): List<CartaBlackjack> = (this[key] as? List<*>)
            .orEmpty()
            .mapNotNull { card ->
                val values = card as? Map<*, *> ?: return@mapNotNull null
                val rank = values["rank"] as? String ?: return@mapNotNull null
                val suit = values["suit"] as? String ?: return@mapNotNull null
                CartaBlackjack(rank, suit)
            }
        return EstadoBlackjack(
            gameId = gameId,
            status = this["status"] as? String ?: "active",
            cartasJogador = cards("playerCards"),
            cartasDealer = cards("dealerCards"),
            cartaOculta = this["dealerHoleHidden"] as? Boolean ?: false,
            apostaCentavos = (this["wagerCents"] as? Number)?.toLong() ?: 0L,
            resultado = this["outcome"] as? String ?: "",
            premioCentavos = (this["payoutCents"] as? Number)?.toLong() ?: 0L,
            lucroCentavos = (this["profitCents"] as? Number)?.toLong() ?: 0L,
            saldoCentavos = (this["balanceCents"] as? Number)?.toLong() ?: 0L,
        )
    }
}