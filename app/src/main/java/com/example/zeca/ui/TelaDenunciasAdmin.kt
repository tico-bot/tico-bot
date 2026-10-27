package com.example.zeca.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.zeca.DenunciaModeracao

@Composable
fun TelaDenunciasAdmin(
    onVoltar: () -> Unit,
    onCarregar: ((List<DenunciaModeracao>, Exception?) -> Unit) -> Unit,
    onModerar: (String, String, Boolean, String, (Exception?) -> Unit) -> Unit,
) {
    var denuncias by remember { mutableStateOf<List<DenunciaModeracao>>(emptyList()) }
    var carregando by remember { mutableStateOf(true) }
    var acaoAtiva by remember { mutableStateOf<String?>(null) }
    var mensagem by remember { mutableStateOf<String?>(null) }
    var confirmacaoBloqueio by remember { mutableStateOf<DenunciaModeracao?>(null) }
    val motivos = remember { mutableStateMapOf<String, String>() }

    fun carregar() {
        carregando = true
        onCarregar { resultado, erro ->
            carregando = false
            if (erro == null) {
                denuncias = resultado
                mensagem = null
            } else {
                mensagem = erro.localizedMessage ?: "Não foi possível carregar as denúncias."
            }
        }
    }

    fun moderar(
        denuncia: DenunciaModeracao,
        status: String,
        bloquear: Boolean = false,
    ) {
        val motivo = motivos[denuncia.id].orEmpty().trim()
        if (motivo.length < 5) {
            mensagem = "Informe uma justificativa com pelo menos 5 caracteres."
            return
        }
        acaoAtiva = denuncia.id
        mensagem = null
        onModerar(denuncia.id, status, bloquear, motivo) { erro ->
            acaoAtiva = null
            if (erro == null) carregar()
            else mensagem = erro.localizedMessage ?: "Não foi possível atualizar a denúncia."
        }
    }

    LaunchedEffect(Unit) { carregar() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF101821))
            .verticalScroll(rememberScrollState())
            .padding(start = 18.dp, top = 24.dp, end = 18.dp, bottom = 110.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TextButton(onClick = onVoltar) { Text("Voltar à administração") }
        Text("Denúncias da comunidade", color = Color.White, fontWeight = FontWeight.Bold)
        if (carregando) CircularProgressIndicator()
        mensagem?.let { Text(it, color = Color(0xFFFF8A80)) }
        if (!carregando && denuncias.isEmpty()) {
            Text("Não há denúncias pendentes.", color = Color(0xFFB7C4CC))
        }
        denuncias.forEach { denuncia ->
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF1A2631)),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("${nomeCategoriaDenuncia(denuncia.categoria)} · ${denuncia.status}", color = Color(0xFF18C991), fontWeight = FontWeight.Bold)
                    Text("Denunciante: ${denuncia.denunciante}", color = Color.White)
                    Text("Usuário: ${denuncia.usuarioAlvo} (${denuncia.usuarioAlvoId})", color = Color.White)
                    Text(denuncia.detalhes, color = Color(0xFFB7C4CC))
                    OutlinedTextField(
                        value = motivos[denuncia.id].orEmpty(),
                        onValueChange = { motivos[denuncia.id] = it.take(500) },
                        label = { Text("Justificativa da ação") },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = acaoAtiva == null,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (denuncia.status == "open") {
                            Button(
                                enabled = acaoAtiva == null,
                                onClick = { moderar(denuncia, "reviewing") },
                            ) { Text("Analisar") }
                        }
                        if (denuncia.status == "reviewing") {
                            Button(
                                enabled = acaoAtiva == null,
                                onClick = { moderar(denuncia, "resolved") },
                            ) { Text("Resolver") }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            enabled = acaoAtiva == null,
                            onClick = { moderar(denuncia, "dismissed") },
                        ) { Text("Arquivar") }
                        if (denuncia.status == "reviewing") {
                            Button(
                                enabled = acaoAtiva == null,
                                onClick = { confirmacaoBloqueio = denuncia },
                            ) { Text("Resolver e bloquear") }
                        }
                    }
                    if (acaoAtiva == denuncia.id) {
                        Spacer(Modifier.height(2.dp))
                        CircularProgressIndicator()
                    }
                }
            }
        }

        confirmacaoBloqueio?.let { denuncia ->
            AlertDialog(
                onDismissRequest = { confirmacaoBloqueio = null },
                title = { Text("Bloquear usuário?") },
                text = { Text("A conta de ${denuncia.usuarioAlvo} será desativada. A ação será registrada no histórico administrativo.") },
                confirmButton = {
                    TextButton(onClick = {
                        confirmacaoBloqueio = null
                        moderar(denuncia, "resolved", bloquear = true)
                    }) { Text("Bloquear e resolver") }
                },
                dismissButton = {
                    TextButton(onClick = { confirmacaoBloqueio = null }) { Text("Cancelar") }
                },
            )
        }
    }
}

private fun nomeCategoriaDenuncia(categoria: String): String = when (categoria) {
    "harassment" -> "Assédio ou ofensas"
    "cheating" -> "Trapaça"
    "spam" -> "Spam"
    "inappropriate_content" -> "Conteúdo impróprio"
    else -> "Outro"
}
